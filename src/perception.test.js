import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {trackingState,createDetection,updateDetection} from './perception.js';

test('depth estimates jump in both directions and reacquire an exact unshifted pose',()=>{
  for(const kind of ['vehicle','pedestrian','signal']){
    const states=[];
    for(let frame=0;frame<19*60;frame++)states.push(trackingState(0,75,frame/60,10,kind));
    assert.ok(states.some(s=>s.z>0),`${kind} must jump backwards`);
    assert.ok(states.some(s=>s.z<0),`${kind} must jump forwards`);
    assert.ok(states.some(s=>!s.visible));
    assert.ok(states.some(s=>s.state==='flicker'));
    for(const s of states.filter(s=>s.state==='stable'||s.state==='reacquired')){
      assert.equal(s.x,0);assert.equal(s.z,0);assert.equal(s.yaw,0);assert.equal(s.duplicate,false);
    }
    assert.ok(states.filter(s=>s.state==='stable').length>states.length*.93);
    assert.ok(states.every(s=>Math.abs(s.z)<=3));
  }
});

test('depth shifts are brief stepped estimates rather than continuous shaking',()=>{
  const a=trackingState(0,70,.37),b=trackingState(0,70,.41),c=trackingState(0,70,.51);
  assert.equal(a.z,b.z);assert.notEqual(a.z,c.z);
  assert.equal(Math.sign(a.z),-Math.sign(c.z));
  assert.equal(c.duplicate,true);
  assert.equal(trackingState(0,70,1.1).duplicate,false);
});

test('near tracks remain stable and mid-range failures occur less often',()=>{
  let middleFailures=0,farFailures=0;
  for(let frame=0;frame<57*60;frame++){
    const time=frame/60,near=trackingState(0,12,time);
    assert.equal(near.visible,true);assert.equal(near.state,'stable');assert.equal(near.z,0);
    middleFailures+=trackingState(0,35,time).state!=='stable';
    farFailures+=trackingState(0,75,time).state!=='stable';
  }
  assert.ok(middleFailures>0&&middleFailures<farFailures*.5);
});

test('signal recognition shifts only its display track and retains physical signal materials',()=>{
  const material=new THREE.MeshBasicMaterial({color:0xff0000});
  const lamp=new THREE.Mesh(new THREE.BoxGeometry(.3,.9,.3),material);
  const detection=createDetection(lamp,null,'',{kind:'signal'});
  detection.group.position.set(8,6,-72);detection.group.rotation.y=.3;
  const position=detection.group.position.clone(),rotation=detection.group.quaternion.clone();
  let positive=false,negative=false;
  for(let frame=0;frame<26*60;frame++){
    updateDetection(detection,72,1/60,frame/60);
    positive||=detection.track.position.z>0;negative||=detection.track.position.z<0;
    assert.ok(detection.group.position.equals(position));
    assert.ok(detection.group.quaternion.equals(rotation));
    assert.equal(detection.ghost.visible,false);
    assert.equal(lamp.material,material);
  }
  assert.ok(positive&&negative);
  updateDetection(detection,12,1/60,30);
  assert.deepEqual(detection.track.position.toArray(),[0,0,0]);
});

test('offscreen detections cannot leave a visible duplicate or a stale offset',()=>{
  const detection=createDetection(new THREE.Group());
  detection.track.position.set(1,0,2);detection.ghost.visible=true;
  updateDetection(detection,150,1/60,10);
  assert.equal(detection.group.visible,false);assert.equal(detection.ghost.visible,false);
  assert.deepEqual(detection.track.position.toArray(),[0,0,0]);
});
