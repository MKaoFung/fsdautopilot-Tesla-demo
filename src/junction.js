import * as THREE from 'three';
import {ROAD_HALF_WIDTH,LANE_WIDTH,STOP_OFFSET} from './road.js';
import {createDetection,updateDetection} from './perception.js';
const material=color=>new THREE.MeshStandardMaterial({color,roughness:1,side:THREE.DoubleSide});

export function createJunction(){
  const group=new THREE.Group(),heads=[],detections=[],h=ROAD_HALF_WIDTH;
  const asphalt=material(0xe2e4e1),paint=material(0x979f9d),white=material(0xf8f8f4),yellow=material(0xd7ae36);
  function plane(width,depth,x,z,mat,y=.028){const m=new THREE.Mesh(new THREE.PlaneGeometry(width,depth),mat);m.rotation.x=-Math.PI/2;m.position.set(x,y,z);group.add(m);return m;}
  plane(130,h*2,0,0,asphalt,.01);plane(h*2,130,0,0,asphalt,.012);
  // Opposite halves have independent stop lines and legal right-hand lane centers.
  for(const sign of [-1,1]){
    for(const d of [-.12,.12]){plane(.045,42,d,sign*44,yellow);plane(42,.045,sign*44,d,yellow);}
    for(const lane of [1,2])for(let s=25;s<65;s+=7){plane(.06,3.6,sign*lane*LANE_WIDTH,s,paint);plane(.06,3.6,sign*lane*LANE_WIDTH,-s,paint);plane(3.6,.06,s,sign*lane*LANE_WIDTH,paint);plane(3.6,.06,-s,sign*lane*LANE_WIDTH,paint);}
    plane(h,.22,sign*h/2,sign*STOP_OFFSET,paint,.05);plane(.22,h,-sign*STOP_OFFSET,sign*h/2,paint,.05);
    for(let x=-h+.5;x<h;x+=1.15){plane(.65,2.5,x,sign*15,white,.045);plane(2.5,.65,sign*15,x,white,.045);}
  }
  const pavement=material(0xd0d3d0);
  // These are lane-use road markings, never symbols on the blue planned path.
  for(const lane of [-1,0,1]){
    const points=lane===0?[[-.12,1.5],[.12,1.5],[.12,-.6],[.6,-.6],[0,-1.4],[-.6,-.6],[-.12,-.6]]:
      [[-.12,1.5],[.12,1.5],[.12,-.3],[.6,-.3],[.6,.1],[1.3,-.5],[.6,-1.1],[.6,-.7],[-.12,-.7]];
    const shape=new THREE.Shape(points.map(([x,y])=>new THREE.Vector2(lane<0?-x:x,-y)));
    const arrow=new THREE.Mesh(new THREE.ShapeGeometry(shape),paint);arrow.rotation.x=-Math.PI/2;arrow.position.set((lane+1.5)*LANE_WIDTH,.048,30);group.add(arrow);
  }
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const shape=new THREE.Shape();shape.moveTo(h,65);shape.lineTo(65,65);shape.lineTo(65,h);shape.lineTo(h+6,h);shape.quadraticCurveTo(h,h,h,h+6);shape.closePath();
    const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape,16),pavement);mesh.rotation.x=Math.PI/2;mesh.scale.set(sx,sz,1);mesh.position.y=.04;group.add(mesh);
  }
  const metal=material(0x929c9f),housing=material(0x343f47);
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.06,.09,5.9,8),metal);pole.position.set(h+.5,2.95,STOP_OFFSET);group.add(pole);
  const arm=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,h,8),metal);arm.rotation.z=Math.PI/2;arm.position.set(h/2,5.65,STOP_OFFSET);group.add(arm);
  for(const x of [.5,1.5,2.5].map(v=>v*LANE_WIDTH)){
    const head=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(.49,1.30,.38),housing);head.add(body);
    const lamps=[];
    for(let i=0;i<3;i++){const light=new THREE.Mesh(new THREE.CircleGeometry(.143,16),new THREE.MeshBasicMaterial({color:0x27343c}));light.position.set(0,.4-i*.38,.20);head.add(light);lamps.push(light);}
    const d=createDetection(head,null,'',{kind:'signal'});d.group.position.set(x,5,STOP_OFFSET);group.add(d.group);heads.push(lamps);detections.push(d);
  }
  return {group,detections,update(light,distance=50,dt=1/60,time=0){
    heads.forEach(lamps=>lamps.forEach((lamp,i)=>lamp.material.color.setHex(i===({red:0,amber:1,green:2}[light])?[0xfa3045,0xffb52e,0x32e47a][i]:0x27343c)));
    detections.forEach(d=>updateDetection(d,Math.abs(distance-STOP_OFFSET),dt,time));
  }};
}
