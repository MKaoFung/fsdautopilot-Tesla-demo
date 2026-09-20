import * as THREE from 'three';
import {roadPoint,heading} from './simulation.js';
import {createPedestrian,animatePedestrian} from './pedestrian.js';
import {createDetection,updateDetection} from './perception.js';
import {buildingSpec,buildingConfidence,createBuildingLibrary} from './buildings.js';

const hash=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
export function createCity(scene){
  const library=createBuildingLibrary(),buildings=[];
  for(let i=0;i<20;i++){
    const group=new THREE.Group();
    const materials=[0xc9cdcb,0xb7bdbb,0xaab4b6].map(color=>new THREE.MeshStandardMaterial({color,roughness:1,transparent:true,opacity:0,depthWrite:false}));
    const meshes=library.get('storefront').map((geometry,j)=>new THREE.Mesh(geometry,materials[j]));
    group.add(...meshes);scene.add(group);
    buildings.push({group,materials,meshes,key:null,age:0,s:0,offset:0});
  }
  const walkers=Array.from({length:18},(_,i)=>{
    const detection=createDetection(createPedestrian(i+10),null,'',{kind:'pedestrian'});scene.add(detection.group);
    return {detection,s:15+i*11,side:i%2?1:-1,speed:.65+hash(i)*.85,direction:i%3?-1:1};
  });
  return {walkers,update(sim,dt){
    let recognized=0;
    const baseIndex=Math.floor(sim.s/42)-2;
    buildings.forEach((b,i)=>{
      const slot=Math.floor(i/2),index=baseIndex+((slot-baseIndex%10+10)%10),key=index*2+i%2;
      if(b.key!==key){
        const spec=buildingSpec(key);b.key=key;b.s=index*42+hash(key)*10;b.age=0;b.offset=(i%2?1:-1)*spec.offset;
        b.group.scale.set(spec.width,spec.height,spec.depth);
        b.meshes.forEach((mesh,j)=>{mesh.geometry=library.get(spec.type)[j];});
        b.materials[0].color.setHSL(.36+spec.shade*.09,.018,.69+spec.shade*.10);
        b.group.userData.type=spec.type;
      }
      const distance=b.s-sim.s,junctionDelta=((b.s-155+140)%280+280)%280-140;
      const visible=distance>-65&&distance<145&&Math.abs(junctionDelta)>33;
      b.group.visible=visible;if(!visible)return;
      b.age+=dt;
      const confidence=buildingConfidence(key,distance,b.age,sim.time);
      for(const material of b.materials)material.opacity=confidence;
      const p=roadPoint(b.s,b.offset,sim.s);b.group.position.set(p.x,0,p.z);b.group.rotation.y=-heading(b.s)+(b.offset<0?Math.PI:0);
      if(confidence>.1)recognized++;
    });
    walkers.forEach((w,i)=>{
      w.s+=w.speed*w.direction*dt;
      if(w.s<sim.s-35||w.s>sim.s+220)w.s=sim.s+145+i*3;
      const p=roadPoint(w.s,w.side*(12.5+hash(i)*1.3),sim.s);
      w.detection.group.position.set(p.x,0,p.z);w.detection.group.rotation.y=-heading(w.s)+(w.direction<0?Math.PI:0);
      updateDetection(w.detection,w.s-sim.s,dt,sim.time);
      animatePedestrian(w.detection.actual,sim.time*(4+w.speed*2)+i,true);
    });
    return recognized;
  }};
}
