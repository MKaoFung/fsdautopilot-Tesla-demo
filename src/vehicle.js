import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {addFastback} from './fastback.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

function batchStaticMeshes(group){
  const batches=new Map();
  for(const mesh of [...group.children]){
    if(!mesh.isMesh)continue;mesh.updateMatrix();
    const geometries=batches.get(mesh.material)||[];geometries.push(mesh.geometry.clone().applyMatrix4(mesh.matrix));batches.set(mesh.material,geometries);group.remove(mesh);
  }
  for(const [material,geometries] of batches){
    // Surface lofts do not need UVs, and keeping a common layout allows batching.
    for(const geometry of geometries){geometry.deleteAttribute('uv');if(!geometry.index)geometry.setIndex(Array.from({length:geometry.attributes.position.count},(_,i)=>i));}
    const geometry=mergeGeometries(geometries);const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
    geometries.forEach(g=>g.dispose());
  }
}

const profiles = {
  sedan: {length:4.72,width:1.90,deck:.98,roof:1.48,front:-1.10,rear:1.32,roofFront:-.5,roofRear:.63,wheelbase:2.8},
  suv: {length:4.8,width:1.98,deck:1.12,roof:1.81,front:-1.13,rear:1.82,roofFront:-.68,roofRear:1.33,wheelbase:2.87},
  hatch: {length:3.98,width:1.78,deck:.98,roof:1.51,front:-.92,rear:1.64,roofFront:-.44,roofRear:1.05,wheelbase:2.52},
  van: {length:5.18,width:2.02,deck:1.17,roof:2.22,front:-1.68,rear:2.33,roofFront:-1.36,roofRear:2.11,wheelbase:3.18},
  pickup: {length:5.32,width:2.04,deck:1.09,roof:1.81,front:-1.6,rear:.48,roofFront:-1.14,roofRear:.24,wheelbase:3.25},
};

function bodyGeometry(p) {
  // Fixed cross-section order and monotone longitudinal interpolation avoid pinched ends.
  const outline=[[1,.48],[1,.76],[.96,.94],[.85,1],[0,1.015],[-.85,1],[-.96,.94],[-1,.76],[-1,.48],[-.87,.33],[.87,.33]];
  const pos=[],ids=[],n=48,m=outline.length;
  for(let i=0;i<=n;i++){
    const t=i/n,z=(t-.5)*p.length;
    const taper=1-.15*Math.pow(Math.abs(2*t-1),4);
    const hoodSlope=p.deck-(modelHood(p)?Math.max(0,.33-t)*.32:0);
    for(const [x,y] of outline)pos.push(x*p.width*.5*taper,.08+y*(hoodSlope-.08),z);
  }
  for(let i=0;i<n;i++)for(let j=0;j<m;j++){const a=i*m+j,b=i*m+(j+1)%m,c=b+m,d=a+m;ids.push(a,b,d,b,c,d);}
  const front=pos.length/3;pos.push(0,p.deck*.58,-p.length*.5);
  const rear=pos.length/3;pos.push(0,p.deck*.58,p.length*.5);
  for(let j=0;j<m;j++){ids.push(front,(j+1)%m,j);ids.push(rear,n*m+j,n*m+(j+1)%m);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(ids);g.computeVertexNormals();return g;
}

function panel(points,mat){
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3));
  g.setIndex([0,1,2,0,2,3]);g.computeVertexNormals();return new THREE.Mesh(g,mat);
}
const cache=new Map();
function modelHood(p){return p.roof<2;}
export function createVehicle(color=0x858b8e,self=false,model='sedan') {
  const p=profiles[model]||profiles.sedan,g=new THREE.Group();
  const paint=new THREE.MeshStandardMaterial({color,roughness:.32,metalness:.32});
  const dark=new THREE.MeshStandardMaterial({color:0x262c30,roughness:.75});
  const glass=new THREE.MeshStandardMaterial({color:0x17242c,roughness:.22,metalness:.4,side:THREE.DoubleSide});
  const rubber=new THREE.MeshStandardMaterial({color:0x282d31,roughness:.88});
  const chrome=new THREE.MeshStandardMaterial({color:0x939b9e,roughness:.48,metalness:.5});
  const w=p.width*.5,rw=w*.78,baseY=p.deck-.01,roof=p.roof;
  if(model==='sedan')addFastback(g,paint,glass,dark);
  else {
  if(!cache.has(model))cache.set(model,bodyGeometry(p));
  const body=new THREE.Mesh(cache.get(model),paint);g.add(body);
  const cabin=new THREE.BufferGeometry();
  const verts=[[-w*.9,baseY,p.front],[w*.9,baseY,p.front],[rw,roof,p.roofFront],[-rw,roof,p.roofFront],[-w*.9,baseY,p.rear],[w*.9,baseY,p.rear],[rw,roof,p.roofRear],[-rw,roof,p.roofRear]];
  cabin.setAttribute('position',new THREE.Float32BufferAttribute(verts.flat(),3));
  cabin.setIndex([0,1,2,0,2,3,3,2,6,3,6,7,7,6,5,7,5,4,0,3,7,0,7,4,1,5,6,1,6,2]);cabin.computeVertexNormals();
  g.add(new THREE.Mesh(cabin,paint));
  if(model!=='van'&&model!=='pickup'){
    g.add(panel([[-rw*.9,roof+.005,p.roofFront+.1],[rw*.9,roof+.005,p.roofFront+.1],[rw*.9,roof+.005,p.roofRear-.06],[-rw*.9,roof+.005,p.roofRear-.06]],glass));
  }
  // Windshield and rear window sit inside painted A/C pillars, not as a separate blob.
  g.add(panel([[-w*.78,baseY+.08,p.front-.006],[w*.78,baseY+.08,p.front-.006],[rw*.92,roof-.045,p.roofFront-.018],[-rw*.92,roof-.045,p.roofFront-.018]],glass));
  g.add(panel([[-rw*.91,roof-.045,p.roofRear+.018],[rw*.91,roof-.045,p.roofRear+.018],[w*.77,baseY+.10,p.rear+.008],[-w*.77,baseY+.10,p.rear+.008]],glass));
  }
  for(const side of [-1,1]){
    const a=[side*(w*.90+.005),baseY+.1,p.front+.14],b=[side*(rw+.008),roof-.075,p.roofFront+.10];
    const c=[side*(rw+.008),roof-.075,p.roofRear-.08],d=[side*(w*.90+.005),baseY+.1,p.rear-.13];
    if(model!=='sedan')g.add(panel([a,b,c,d],glass));
    const pillar=new THREE.Mesh(new RoundedBoxGeometry(.075,roof-baseY-.12,.085,2,.02),paint);
    pillar.position.set(side*(w*.84),baseY+(roof-baseY)*.5,(p.front+p.rear)*.42);if(model!=='sedan')g.add(pillar);
    const mirror=new THREE.Mesh(new RoundedBoxGeometry(.24,.12,.19,3,.05),paint);
    mirror.position.set(side*(w+.08),baseY+.12,p.front+.38);g.add(mirror);
    if(model!=='van'){
      const handle=new THREE.Mesh(new RoundedBoxGeometry(.025,.032,.18,2,.012),chrome);
      handle.position.set(side*(w+.004),p.deck*.83,.25);g.add(handle);
    }
  }
  if(model==='pickup'){
    const bed=new THREE.Mesh(new RoundedBoxGeometry(p.width*.77,.07,1.73,3,.035),dark);bed.position.set(0,p.deck+.025,1.50);g.add(bed);
  }
  if(model==='van'){
    const panelSide=new THREE.Mesh(new RoundedBoxGeometry(.025,.79,1.7,3,.09),paint);panelSide.position.set(w*.82,1.59,1.06);g.add(panelSide);
    const other=panelSide.clone();other.position.x*=-1;g.add(other);
  }
  const wheels=[],frontPivots=[];
  for(const side of [-1,1])for(const front of [true,false]){
    const pivot=new THREE.Group();pivot.position.set(side*(w-.065),.35,front?-p.wheelbase*.5:p.wheelbase*.5);g.add(pivot);
    const axle=new THREE.Group();pivot.add(axle);
    const tireGeo=new THREE.CylinderGeometry(.35,.35,.22,28);tireGeo.rotateZ(Math.PI/2);
    const tire=new THREE.Mesh(tireGeo,rubber);axle.add(tire);
    const hubGeo=new THREE.CylinderGeometry(.24,.24,.224,24);hubGeo.rotateZ(Math.PI/2);axle.add(new THREE.Mesh(hubGeo,chrome));
    for(let spoke=0;spoke<5;spoke++){
      const spokeMesh=new THREE.Mesh(new THREE.BoxGeometry(.228,.032,.39),dark);spokeMesh.rotation.x=spoke*Math.PI/5;axle.add(spokeMesh);
    }
    batchStaticMeshes(axle);wheels.push(axle);if(front)frontPivots.push(pivot);
  }
  const brake=new THREE.MeshStandardMaterial({color:0x9f2930,emissive:0xd72b31,emissiveIntensity:.25});
  const signals=[];
  for(const side of [-1,1]){
    const signalMat=new THREE.MeshBasicMaterial({color:0x4b4540});signals.push(signalMat);
    for(const front of [true,false]){
      const mat=front?new THREE.MeshStandardMaterial({color:0xcbd4d9,emissive:0xb8d3dc,emissiveIntensity:.15}):brake;
      const light=new THREE.Mesh(new RoundedBoxGeometry(.49,model==='sedan'?.042:.075,.035,3,.014),mat);light.position.set(side*w*.59,p.deck*(front?.65:.80),(front?-1:1)*(p.length*.5+.012));g.add(light);
      const indicator=new THREE.Mesh(new RoundedBoxGeometry(.13,.07,.037,2,.015),signalMat);indicator.position.set(side*w*.86,p.deck*.8,(front?-1:1)*(p.length*.5+.015));g.add(indicator);
    }
  }
  const rearBumper=new THREE.Mesh(new RoundedBoxGeometry(p.width*.8,.15,.09,3,.035),dark);rearBumper.position.set(0,.4,p.length*.5);g.add(rearBumper);
  const plate=new THREE.Mesh(new RoundedBoxGeometry(.35,.1,.015,2,.01),basicPlate());plate.position.set(0,.62,p.length*.5+.026);g.add(plate);
  batchStaticMeshes(g);g.traverse(o=>{if(o.isMesh){o.castShadow=self;o.receiveShadow=true;}});
  g.userData={signals,brake,paint,self,wheels,frontPivots,model,wheelbase:p.wheelbase};return g;
}
function basicPlate(){return new THREE.MeshBasicMaterial({color:0xb4bdc1});}

export function animateVehicle(mesh,rotation,steering=0){
  mesh.userData.wheels.forEach(w=>w.rotation.x=rotation);
  mesh.userData.frontPivots.forEach(p=>p.rotation.y=steering);
}
