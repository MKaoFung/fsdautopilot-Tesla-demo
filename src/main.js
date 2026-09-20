import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {Simulation,laneWidth,laneX,roadPoint,heading,clamp,smooth} from './simulation.js';
import {createVehicle,animateVehicle} from './vehicle.js';
import {createDetection,updateDetection,laneTrackingState} from './perception.js';
import {createPedestrian,animatePedestrian} from './pedestrian.js';
import {createJunction} from './junction.js';
import {createCity} from './city.js';
import {routePose,junctionPose,inJunction,ROAD_HALF_WIDTH} from './road.js';
import enabledUrl from '../outputs/noa_enabled.mp3?url';
import disabledUrl from '../outputs/noa_disabled.mp3?url';

const $=id=>document.getElementById(id),sim=new Simulation();
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
let resolution=Math.min(devicePixelRatio,1.35);
renderer.setPixelRatio(resolution);renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
$('scene').append(renderer.domElement);renderer.domElement.setAttribute('aria-label','道路、车辆与实时规划路径');
const scene=new THREE.Scene();scene.background=new THREE.Color(0xf1f2ef);scene.fog=new THREE.Fog(0xf1f2ef,55,165);
const camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,.1,350);camera.position.set(laneX(0,0),15,22);camera.lookAt(laneX(0,0),0,-12);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.dampingFactor=.08;controls.enablePan=false;
controls.minDistance=8;controls.maxDistance=65;controls.minPolarAngle=.22;controls.maxPolarAngle=Math.PI*.47;
controls.target.set(laneX(0,0),.7,0);controls.update();
const cameraTarget=new THREE.Vector3(laneX(0,0),.7,0),cameraDestination=new THREE.Vector3();
let cameraTransition=null;
scene.add(new THREE.HemisphereLight(0xffffff,0x8e9399,2.4));
const sun=new THREE.DirectionalLight(0xffffff,2.5);sun.position.set(-20,40,18);sun.castShadow=true;
sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-25,right:25,top:45,bottom:-25,far:110});sun.shadow.bias=-.0005;scene.add(sun);
const surface=new THREE.Mesh(new THREE.PlaneGeometry(700,700),new THREE.MeshStandardMaterial({color:0xe9eae7,roughness:1}));
surface.rotation.x=-Math.PI/2;surface.position.y=-.03;surface.receiveShadow=true;scene.add(surface);

// Every painted strip uses the same road coordinates as the vehicles and planner.
function strip(count,material){
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array((count+1)*6),3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv',new THREE.BufferAttribute(new Float32Array((count+1)*4),2).setUsage(THREE.DynamicDrawUsage));
  const ids=[];for(let i=0;i<count;i++){const a=i*2;ids.push(a,a+1,a+2,a+1,a+3,a+2);}
  geometry.setIndex(ids);const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);return mesh;
}
function updateStrip(mesh,start,end,point,y=.025){
  const pos=mesh.geometry.attributes.position,uv=mesh.geometry.attributes.uv,count=pos.count/2-1;
  for(let i=0;i<=count;i++){
    const d=start+(end-start)*i/count,spec=point(d);
    const l=roadPoint(sim.s+d,spec.offset-spec.half,sim.s),r=roadPoint(sim.s+d,spec.offset+spec.half,sim.s);
    pos.setXYZ(i*2,l.x,y,l.z);pos.setXYZ(i*2+1,r.x,y,r.z);uv.setXY(i*2,0,d);uv.setXY(i*2+1,1,d);
  }
  pos.needsUpdate=true;uv.needsUpdate=true;
}
const basic=(color,opacity=1)=>new THREE.MeshBasicMaterial({color,opacity,transparent:opacity<1,side:THREE.DoubleSide,depthWrite:false});
const paintMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
  uniforms:{origin:{value:0},junction:{value:155},lost:{value:0}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`varying vec2 vUv;uniform float origin;uniform float junction;uniform float lost;void main(){float s=vUv.y+origin;if(mod(s,8.)>4.5||abs(s-junction)<10.||(lost>.5&&vUv.y>28.&&vUv.y<68.))discard;float fade=1.-smoothstep(55.,150.,vUv.y);gl_FragColor=vec4(.39,.42,.43,fade*.76);}`,
});
const lanes=[-3.5,-2.5,-.5,.5].map(boundary=>({boundary,mesh:strip(230,paintMaterial.clone())}));
const edges=[-1,1].map(side=>({side,mesh:strip(230,basic(0xdf6564,.7))}));
const yellow=[-.12,.12].map(delta=>({delta,mesh:strip(230,basic(0xd7ae36,.86))}));
const road=strip(230,basic(0xe2e4e1,.3));

// Continuous, untextured driving corridor: no arrows or particles.
const routeMat=new THREE.ShaderMaterial({transparent:true,side:THREE.DoubleSide,depthWrite:false,
  uniforms:{engaged:{value:0},pathExtent:{value:80}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`varying vec2 vUv;uniform float engaged;uniform float pathExtent;
  void main(){float edge=1.-smoothstep(.46,.5,abs(vUv.x-.5));float fade=(1.-smoothstep(max(2.5,pathExtent-min(14.,pathExtent*.35)),pathExtent,vUv.y))*smoothstep(2.3,2.7,vUv.y);gl_FragColor=vec4(.015,.37,.96,mix(0.,.87,engaged)*edge*fade);}`,
});
const route=strip(240,routeMat);route.renderOrder=3;
const ego=createVehicle(0xb73341,true);scene.add(ego);
const carMeshes=new Map(),colors=[0x737d82,0xaeb4b2,0x555e64,0x959b9b];
for(const car of sim.objects){
  const mesh=createVehicle(colors[car.id%colors.length],false,car.model);
  const wrong=car.id===2?cone():null;
  const detection=createDetection(mesh,wrong,'类别修正 · 锥桶 → 两厢车');
  scene.add(detection.group);carMeshes.set(car.id,detection);
}
const obstacleMeshes=new Map();
function cone(){const g=new THREE.Group(),b=new THREE.Mesh(new THREE.BoxGeometry(.45,.07,.45),basic(0x515759));const c=new THREE.Mesh(new THREE.ConeGeometry(.19,.67,12),basic(0xe28942));c.position.y=.36;const band=new THREE.Mesh(new THREE.CylinderGeometry(.105,.14,.12,12),basic(0xf9f9f0));band.position.y=.39;g.add(b,c,band);return g;}
for(const obj of sim.obstacles){let mesh;if(obj.kind==='cones'){mesh=new THREE.Group();for(let i=0;i<6;i++){const c=cone();c.position.set((i%3-1)*.65,0,-Math.floor(i/3)*1.2);mesh.add(c);}}else mesh=createVehicle(0x7f8688,false,'van');const detection=createDetection(mesh,obj.kind==='cones'?createVehicle(0x9aa3a9,false,'hatch'):null,'类别修正 · 车辆 → 施工锥桶');obstacleMeshes.set(obj.id,detection);scene.add(detection.group);}

// Junction, stop line and signals share the controller's actual stop location.
const junctionScene=createJunction(),junctionGroup=junctionScene.group;scene.add(junctionGroup);
const crossCars=sim.crossTraffic.map((car,i)=>{const d=createDetection(createVehicle(colors[i],false,car.model));scene.add(d.group);return d;});
const pedestrians=sim.pedestrians.map((p,i)=>{const d=createDetection(createPedestrian(i),null,'',{kind:'pedestrian'});scene.add(d.group);return d;});
const city=createCity(scene);
const perceptionLabel=document.createElement('div');perceptionLabel.className='perception-label';perceptionLabel.setAttribute('aria-live','polite');$('app').append(perceptionLabel);

const audioOn=new Audio(enabledUrl),audioOff=new Audio(disabledUrl);audioOn.preload=audioOff.preload='auto';
let muted=false,audioContext,lastBlink=false;
function playAP(sound){audioOn.pause();audioOff.pause();if(muted)return;sound.currentTime=0;sound.play().then(()=>{$('scene').dataset.audio=sound===audioOn?'enabled':'disabled';}).catch(()=>{$('decision').textContent='音频播放受浏览器限制，可再次点击重试';});}
function tick(){if(muted||!audioContext)return;const o=audioContext.createOscillator(),g=audioContext.createGain();o.type='triangle';o.frequency.value=780;g.gain.setValueAtTime(.022,audioContext.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.035);o.connect(g).connect(audioContext.destination);o.start();o.stop(audioContext.currentTime+.04);}
$('activate-ap').addEventListener('click',()=>{sim.setAP(!sim.active);controls.enabled=!sim.active;
  if(sim.active){cameraTransition={start:sim.time,position:camera.position.clone(),target:controls.target.clone()};audioContext??=new AudioContext();audioContext.resume();}
  else{cameraTransition=null;controls.target.copy(cameraTarget);controls.update();}
  playAP(sim.active?audioOn:audioOff);$('activate-ap').classList.toggle('is-active',sim.active);$('activate-ap').setAttribute('aria-pressed',String(sim.active));$('activate-ap').querySelector('strong').textContent=sim.active?'解除 AP':'激活 AP';$('activate-ap').querySelector('small').textContent=sim.active?'Autopilot engaged':'Autopilot available';});
$('sound-toggle').addEventListener('click',()=>{muted=!muted;audioOn.muted=audioOff.muted=muted;$('sound-toggle').classList.toggle('muted',muted);$('sound-toggle').setAttribute('aria-label',muted?'打开声音':'关闭声音');});
function place(mesh,s,lane){const p=roadPoint(s,laneX(s,lane),sim.s);mesh.position.set(p.x,.02,p.z);mesh.rotation.y=-heading(s);mesh.visible=s-sim.s>-28&&s-sim.s<170;}
let prevSpeed=0,lastUI='',last=performance.now(),accumulator=0,frames=0,uiElapsed=0,perfElapsed=0,perfFrames=0,fps=60,qualityCooldown=0;
function render(){
  requestAnimationFrame(render);const now=performance.now(),rawDt=(now-last)/1000,dt=Math.min(rawDt,.1);last=now;accumulator+=dt;
  perfElapsed+=rawDt;perfFrames++;qualityCooldown=Math.max(0,qualityCooldown-dt);
  if(perfElapsed>=2){fps=perfFrames/perfElapsed;perfElapsed=0;perfFrames=0;
    if(fps<54&&resolution>.8&&qualityCooldown===0){resolution=Math.max(.8,resolution-.15);renderer.setPixelRatio(resolution);qualityCooldown=5;}
    if(fps<44){renderer.shadowMap.enabled=false;}
  }
  while(accumulator>=1/60){sim.update(1/60);accumulator-=1/60;}
  updateStrip(road,-25,200,d=>({offset:0,half:inJunction(sim.s+d,sim.junction)?0:laneWidth(sim.s+d)*3}));
  let laneGlitches=0;
  lanes.forEach((l,i)=>{const tracking=laneTrackingState(i,sim.time),u=l.mesh.material.uniforms;
    u.origin.value=sim.s;u.junction.value=sim.junction;u.lost.value=Number(tracking.lost);
    if(tracking.lost||tracking.offset)laneGlitches++;
    updateStrip(l.mesh,-25,200,d=>({offset:laneX(sim.s+d,l.boundary)+tracking.offset*smooth((d-25)/6)*(1-smooth((d-65)/6)),half:inJunction(sim.s+d,sim.junction)?0:.045}),.035);
  });
  for(const e of edges)updateStrip(e.mesh,-25,200,d=>({offset:e.side*(laneWidth(sim.s+d)*3+.25),half:inJunction(sim.s+d,sim.junction)?0:.05}),.036);
  for(const l of yellow)updateStrip(l.mesh,-25,200,d=>({offset:l.delta,half:inJunction(sim.s+d,sim.junction)?0:.035}),.037);
  const length=sim.active?sim.pathLength:Math.max(16,sim.pathLength);
  updateStrip(route,2.35,Math.max(2.36,length),d=>{const p=sim.pathAt(d);return{offset:p.lateral,half:p.halfWidth};},.07);
  routeMat.uniforms.engaged.value=sim.active?1:0;routeMat.uniforms.pathExtent.value=length;
  place(ego,sim.s,sim.lateral);
  ego.rotation.y=sim.yaw;animateVehicle(ego,sim.wheelRotation,sim.steering);
  ego.userData.brake.emissiveIntensity=sim.v<prevSpeed-.002||sim.mode==='waiting'?2:.25;prevSpeed=sim.v;
  const blink=sim.signal!==0&&sim.phaseTime%.72<.38;
  for(let i=0;i<2;i++)ego.userData.signals[i].color.setHex(blink&&sim.signal===(i===0?-1:1)?0xffa719:0x6b4b26);
  $('indicator-left').classList.toggle('active',blink&&sim.signal<0);$('indicator-right').classList.toggle('active',blink&&sim.signal>0);if(blink&&!lastBlink)tick();lastBlink=blink;
  let correction=null;
  const egoOrigin=routePose(sim.s);
  for(const obj of sim.objects){const d=carMeshes.get(obj.id),p=sim.trafficPose(obj);d.group.position.set(p.x-egoOrigin.x,.02,p.z-egoOrigin.z);d.group.rotation.y=-p.angle;const distance=Math.hypot(d.group.position.x-ego.position.x,d.group.position.z-ego.position.z);correction=updateDetection(d,distance,dt,sim.time)||correction;animateVehicle(d.actual,obj.s/.35);}
  for(const obj of sim.obstacles){const d=obstacleMeshes.get(obj.id);place(d.group,obj.s,obj.lane);correction=updateDetection(d,obj.s-sim.s,dt,sim.time)||correction;}
  const jp=junctionPose(sim.junction),origin=routePose(sim.s),junction={x:jp.x-origin.x,z:jp.z-origin.z};junctionGroup.position.set(junction.x,0,junction.z);junctionGroup.rotation.y=-jp.angle;junctionGroup.visible=Math.abs(sim.junction-sim.s)<170;
  junctionScene.update(sim.light,sim.junction-sim.s,dt,sim.time);
  const a=jp.angle,ca=Math.cos(a),sa=Math.sin(a);
  crossCars.forEach((d,i)=>{const car=sim.crossTraffic[i];d.group.position.set(junction.x+car.x*ca-car.z*sa,.02,junction.z+car.x*sa+car.z*ca);d.group.rotation.y=-car.direction*Math.PI/2-a;updateDetection(d,Math.hypot(sim.junction-sim.s,car.x),dt,sim.time);animateVehicle(d.actual,car.x*car.direction/.35);});
  pedestrians.forEach((d,i)=>{const p=sim.pedestrians[i];d.group.position.set(junction.x+p.x*ca-p.z*sa,.02,junction.z+p.x*sa+p.z*ca);d.group.rotation.y=-p.walk*Math.PI/2-a;updateDetection(d,Math.hypot(sim.junction-sim.s,p.x),dt,sim.time);animatePedestrian(d.actual,sim.time*7+i,p.walking);});
  perceptionLabel.textContent=correction||'';perceptionLabel.classList.toggle('visible',Boolean(correction));
  const recognizedBuildings=city.update(sim,dt);
  if(sim.active){
    const yaw=heading(sim.s),lookDistance=innerWidth<600?10:12;
    cameraDestination.set(ego.position.x-Math.sin(yaw)*22,15,ego.position.z+Math.cos(yaw)*22);
    const target=new THREE.Vector3(ego.position.x+Math.sin(yaw)*lookDistance,0,ego.position.z-Math.cos(yaw)*lookDistance);
    if(cameraTransition){const t=smooth((sim.time-cameraTransition.start)/1.65);camera.position.lerpVectors(cameraTransition.position,cameraDestination,t);cameraTarget.lerpVectors(cameraTransition.target,target,t);if(t===1)cameraTransition=null;}
    else {camera.position.lerp(cameraDestination,1-Math.exp(-dt*5));cameraTarget.lerp(target,1-Math.exp(-dt*5));}
    camera.lookAt(cameraTarget);
  }else{controls.update();cameraTarget.copy(controls.target);}
  uiElapsed+=dt;
  if(uiElapsed>=.1){uiElapsed=0;
  $('speed').textContent=Math.round(sim.v*3.6);$('gear').textContent=sim.active||sim.v>.1?'D':'P';
  const key=sim.message.join('|');if(key!==lastUI){$('drive-state').textContent=sim.message[0];$('decision').textContent=sim.message[1];lastUI=key;}
  $('nav-distance').textContent=`${Math.max(0,Math.round(sim.junction-sim.s))} m`;$('nav-action').textContent=`前方路口${sim.turnDirection>0?'右转':sim.turnDirection<0?'左转':'直行'} · ${sim.light==='red'?'红灯':sim.light==='amber'?'黄灯':'绿灯'}`;
  $('nav-icon').style.transform=`rotate(${sim.turnDirection*90}deg)`;
  $('clock').textContent=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  const detections=[...carMeshes.values(),...obstacleMeshes.values(),...crossCars,...pedestrians,...city.walkers.map(w=>w.detection),...junctionScene.detections].filter(d=>d.group.visible);
  $('scene').dataset.telemetry=JSON.stringify({mode:sim.mode,s:+sim.s.toFixed(2),speed:+sim.v.toFixed(2),lane:sim.lateral,target:sim.targetLane,signal:sim.signal,yaw:sim.yaw,steering:sim.steering,light:sim.light,pathLength:sim.pathLength,changes:sim.metrics.changes,stops:sim.metrics.stops,turns:sim.metrics.turns,requiredLane:sim.turnDirection,junction:sim.junction,trackingErrors:detections.filter(d=>['lost','flicker','offset'].includes(d.state)).length,depthOffsets:detections.filter(d=>d.track.visible&&Math.abs(d.track.position.z)>.1).map(d=>({kind:d.kind,z:+d.track.position.z.toFixed(2)})),duplicates:detections.filter(d=>d.ghost.visible).length,laneGlitches,misclassified:detections.filter(d=>d.misclassified).length,correction,walking:sim.pedestrians.filter(p=>p.walking).length+city.walkers.length,buildings:recognizedBuildings,cameraMode:sim.active?(cameraTransition?'transition':'follow'):'orbit',camera:[camera.position.x,camera.position.y,camera.position.z],fps:+fps.toFixed(1),pixelRatio:resolution,drawCalls:renderer.info.render.calls,models:[...new Set(sim.objects.map(o=>o.model))]});
  }
  renderer.render(scene,camera);if(++frames===2)$('loading').classList.add('hidden');
}
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);}
window.addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>{last=performance.now();accumulator=0;});render();
