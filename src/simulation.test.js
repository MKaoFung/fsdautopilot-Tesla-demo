import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,laneWidth,laneX,roadPoint} from './simulation.js';
import {trackingState,laneTrackingState,createDetection,updateDetection} from './perception.js';
import {createVehicle} from './vehicle.js';
import * as THREE from 'three';
import {routePose,junctionDirection,turnLength,TURN_RADIUS,STOP_OFFSET,inJunction,branchPose} from './road.js';
import {createCity} from './city.js';

function step(sim,seconds){for(let i=0;i<seconds*60;i++)sim.update(1/60);}
test('cruise route remains between its lane boundaries on bends and changing road widths',()=>{
  const s=new Simulation();s.pathLength=100;
  for(let origin=0;origin<2000;origin+=11)for(const lane of [-1,0,1]){
    s.s=origin;s.lane=s.lateral=s.targetLane=lane;
    for(let d=4;d<96;d+=4){
      const p=s.pathAt(d),w=laneWidth(p.s);
      assert.ok(p.lateral-p.halfWidth>laneX(p.s,lane)-w/2);
      assert.ok(p.lateral+p.halfWidth<laneX(p.s,lane)+w/2);
      const center=roadPoint(p.s,p.lateral,origin),vehicle=roadPoint(p.s,laneX(p.s,lane),origin);
      assert.deepEqual(center,vehicle);
    }
  }
});
test('empty road changes lane only to prepare the required turn',()=>{
  const s=new Simulation();s.objects=[];s.obstacles=[];s.setAP(true);step(s,90);
  for(const e of s.events.filter(e=>e.type==='signal'))assert.ok(Math.abs(e.target-e.direction)<Math.abs(e.lane-e.direction));
  assert.ok(s.metrics.changes>0);
});
test('slow traffic triggers indicators before lateral movement and cancels on a blocked gap',()=>{
  const s=new Simulation();s.setAP(true);
  for(let i=0;i<900&&s.mode!=='signalling';i++)s.update(1/60);
  assert.equal(s.mode,'signalling');assert.notEqual(s.signal,0);assert.equal(s.lateral,0);
  s.objects.push({id:99,s:s.s+1,lane:s.targetLane,v:0,cruise:0,kind:'car'});
  s.update(1/60);assert.equal(s.signal,0);assert.equal(s.lateral,0);assert.equal(s.metrics.cancellations,1);
});
test('red light shortens route at the stop line, stops car, and green releases it',()=>{
  const s=new Simulation();s.objects=[];s.obstacles=[];s.time=35;s.s=95;s.setAP(true);
  step(s,10);assert.equal(s.light,'red');assert.ok(s.v<.1);assert.ok(s.stopDistance()>1.5);
  assert.ok(s.pathLength<8);assert.ok(s.s+s.pathLength<s.junction-12);
  const stopped=s.s;step(s,7);assert.equal(s.light,'green');assert.ok(s.s>stopped+2);
});
test('six minutes across random seeds: no ego collisions, signal order, no lane departure',()=>{
  for(const seed of [1,41,732]){
    const s=new Simulation(seed);s.setAP(true);let signalTime=null;
    for(let i=0;i<120*60;i++){
      const previous=s.mode;s.update(1/60);
      if(s.mode==='signalling'&&previous!=='signalling')signalTime=s.time;
      if(s.mode==='changing'&&previous!=='changing')assert.ok(s.time-signalTime>=2.19);
      assert.ok(Math.abs(s.lateral)<=1.001);
      for(const obj of [...s.objects,...s.obstacles])if(!obj.branch&&Math.abs(obj.lane-s.lateral)<.55)assert.ok(Math.abs(obj.s-s.s)>4,`collision seed=${seed} t=${s.time} id=${obj.id}`);
    }
    assert.ok(s.metrics.changes>0);assert.ok(s.metrics.stops>0);assert.ok(s.s>500);
  }
});
test('deactivation decelerates in place laterally and reactivation stays in that lane',()=>{
  const s=new Simulation();s.setAP(true);step(s,8);const lateral=s.lateral;s.setAP(false);
  step(s,8);assert.equal(s.v,0);assert.equal(s.lateral,lateral);
  s.objects=[];s.obstacles=[];s.setAP(true);s.update(1/60);assert.equal(s.lateral,lateral);
  step(s,10);assert.ok(Math.abs(s.lateral-Math.round(s.lateral))<.001);
});

test('vehicle heading matches spatial trajectory and front-wheel steering matches curvature',()=>{
  const s=new Simulation();s.setAP(true);let samples=0;
  for(let i=0;i<18*60;i++){
    s.update(1/60);
    if(s.mode!=='changing')continue;
    const at=d=>roadPoint(d,laneX(d,s.laneAt(d)),0),a=at(s.s-.01),b=at(s.s+.01);
    const tangent=Math.atan2(-(b.x-a.x),-(b.z-a.z));
    assert.ok(Math.abs(s.yaw-tangent)<.001);
    assert.ok(Math.abs(Math.tan(s.steering)/2.8-s.curvature)<.00001);
    assert.ok(Math.abs(s.steering)<.65);samples++;
  }
  assert.ok(samples>40);
});
test('stopped car cannot slide laterally while a lane-change trajectory is pending',()=>{
  const s=new Simulation();s.objects=[];s.obstacles=[];
  s.active=true;s.mode='changing';s.lane=0;s.targetLane=1;s.lateral=.2;s.v=0;
  s.manoeuvre={start:s.s-5,length:30,from:0,to:1};s.lateral=s.laneAt(s.s);
  s.time=38;s.junction=STOP_OFFSET+2.2;const before=s.lateral;
  step(s,1);assert.equal(s.v,0);assert.equal(s.lateral,before);
});
test('cross traffic queues without overlap and pedestrians walk continuously across the zebra crossing',()=>{
  const s=new Simulation();let walked=false,previous=s.pedestrians.map(p=>p.x);
  for(let i=0;i<65*60;i++){
    s.update(1/60);
    s.pedestrians.forEach((p,j)=>{assert.ok(Math.abs(p.x-previous[j])<.05);previous[j]=p.x;if(p.walking)walked=true;});
    for(const a of s.crossTraffic)for(const b of s.crossTraffic)if(a!==b&&a.direction===b.direction)assert.ok(Math.abs(a.x-b.x)>5);
  }
  assert.ok(walked);
});

test('three simulated hours: delayed activation and queues do not deadlock a lane change',()=>{
  for(const delay of [0,20,60,180])for(const seed of [1,41,732]){
    const s=new Simulation(seed);step(s,delay);s.setAP(true);let stopped=0;
    for(let i=0;i<900*60;i++){
      s.update(1/60);stopped=s.v<.1?stopped+1:0;
      assert.ok(stopped<35*60,`deadlock seed=${seed}, delay=${delay}, s=${s.s}, mode=${s.mode}`);
      for(const obj of [...s.objects,...s.obstacles])if(!obj.branch&&Math.abs(obj.lane-s.lateral)<.55)
        assert.ok(Math.abs(obj.s-s.s)>4,`overlap seed=${seed}, delay=${delay}, t=${s.time}`);
      assert.ok(Number.isFinite(s.yaw)&&Number.isFinite(s.steering));
    }
    assert.ok(s.s>6000);assert.ok(s.metrics.changes>0);
  }
});
test('lane changes reserve space at their endpoint even if the target leader stops',()=>{
  const s=new Simulation();s.active=true;s.mode='signalling';s.phaseTime=2.3;s.v=12;s.signal=1;s.targetLane=1;
  s.obstacles=[];s.objects=[{id:1,lane:0,s:42,v:4,cruise:4,kind:'car'},{id:2,lane:1,s:64,v:10,cruise:10,kind:'car'}];
  s.update(1/60);assert.equal(s.mode,'changing');
  assert.ok(s.manoeuvre.start+s.manoeuvre.length<s.objects[1].s-24);
});
test('perception loss, flicker and positional jumps recover without altering world coordinates',()=>{
  const actual=new THREE.Group(),wrong=new THREE.Group(),d=createDetection(actual,wrong);
  d.group.position.set(2,0,-60);const original=d.group.position.clone();
  const states=new Set();let invisible=false;
  for(let i=0;i<20*60;i++){updateDetection(d,60,1/60,i/60);states.add(d.state);invisible||=!d.track.visible;assert.ok(d.group.position.equals(original));}
  assert.ok(invisible);for(const state of ['lost','flicker','offset','reacquired','stable'])assert.ok(states.has(state));
  assert.equal(d.misclassified,true);
  updateDetection(d,35,1/60,21);updateDetection(d,35,1/60,22);
  assert.equal(d.misclassified,false);assert.equal(actual.visible,true);assert.equal(wrong.visible,false);
  for(let t=0;t<20;t+=.03){const state=trackingState(2,10,t);assert.equal(state.visible,true);assert.equal(state.x,0);}
  assert.equal(laneTrackingState(0,7.1).lost,true);
  assert.notEqual(laneTrackingState(0,7.4).offset,0);
  assert.equal(laneTrackingState(0,8).lost,false);assert.equal(laneTrackingState(0,8).offset,0);
});
test('fastback geometry is finite, within vehicle dimensions, and has a curved glass roof',()=>{
  const car=createVehicle(0xb73341,true);const bounds=new THREE.Box3().setFromObject(car),size=bounds.getSize(new THREE.Vector3());
  assert.ok(size.x<2.4&&size.x>1.8);assert.ok(size.y<1.6&&size.y>1.4);assert.ok(size.z>4.7&&size.z<5);
  let curvedGlass=false;
  car.traverse(mesh=>{if(!mesh.isMesh)return;assert.equal(Boolean(mesh.isPoints),false);
    for(const value of mesh.geometry.attributes.position.array)assert.ok(Number.isFinite(value));
    if(mesh.material.color.getHex()===0x17242c&&mesh.geometry.attributes.position.count>100)curvedGlass=true;
  });assert.ok(curvedGlass);
});
test('intersections make actual continuous ninety-degree left and right turns',()=>{
  for(const j of [155,435]){
    const start=j-TURN_RADIUS,end=start+turnLength,a=routePose(start),b=routePose(end),dir=junctionDirection(j);
    assert.ok(Math.abs(b.angle-a.angle-dir*Math.PI/2)<.001);
    for(const boundary of [start,end]){
      const left=routePose(boundary-.001),right=routePose(boundary+.001);
      assert.ok(Math.hypot(left.x-right.x,left.z-right.z)<.003);
      assert.ok(Math.abs(left.angle-right.angle)<.001);
    }
    const s=new Simulation();s.s=start+5;s.lane=s.lateral=0;
    assert.ok(Math.abs(s.poseAt(s.s).steering)>.1);
  }
});
test('green dominates the signal cycle and both turn directions complete with indicators',()=>{
  const s=new Simulation();s.objects=[];s.obstacles=[];s.setAP(true);let greens=0,reds=0;const turning=new Set();
  for(let i=0;i<100*60;i++){
    s.update(1/60);if(s.light==='green')greens++;if(s.light==='red')reds++;
    if(Math.abs(s.curvature)>.04&&s.v>.2&&Math.abs(s.junction-s.s)<15){assert.equal(s.signal,s.turnDirection);turning.add(s.turnDirection);}
  }
  assert.ok(greens>reds*2);assert.ok(turning.has(1)&&turning.has(-1));assert.ok(s.metrics.turns>=2);
});
test('blue corridor has a rectangular end rather than a narrowing arrow tip',()=>{
  const s=new Simulation();s.pathLength=60;
  assert.ok(s.pathAt(60).halfWidth>.5);
  assert.ok(Math.abs(s.pathAt(59.9).halfWidth-s.pathAt(60).halfWidth)<.01);
});
test('city includes progressive building acquisition and varied walking tracks',()=>{
  const scene=new THREE.Scene(),city=createCity(scene),s=new Simulation();
  assert.equal(city.walkers.length,18);assert.equal(s.pedestrians.length,10);
  const initial=city.update(s,0);let later=0;
  for(let i=0;i<150;i++){s.time+=1/60;later=city.update(s,1/60);}
  assert.ok(later>initial);assert.ok(city.walkers.some(w=>w.speed!==city.walkers[0].speed));
  assert.ok(new Set(city.walkers.map(w=>w.detection.actual.scale.y)).size>=4);
});
