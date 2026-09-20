import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {BUILDING_TYPES,buildingSpec,buildingConfidence,createBuildingLibrary} from './buildings.js';
import {createCity} from './city.js';
import {roadPoint,heading} from './simulation.js';

test('deterministic city varies silhouettes and keeps buildings outside the sidewalk',()=>{
  const types=new Set();
  for(let key=-25;key<25;key++){
    const spec=buildingSpec(key);types.add(spec.type);
    assert.deepEqual(spec,buildingSpec(key));
    assert.ok(spec.offset-spec.width/2>=20);
  }
  assert.deepEqual([...types].sort(),[...BUILDING_TYPES].sort());
});

test('buildings acquire individually and fade at the sensing boundary',()=>{
  assert.equal(buildingConfidence(0,80,0,5),0);
  assert.ok(buildingConfidence(0,60,4,5)>.8);
  assert.ok(buildingConfidence(0,140,4,5)<.1);
  assert.equal(buildingConfidence(0,180,4,5),0);
  assert.notEqual(buildingConfidence(0,60,2,5),buildingConfidence(1,60,2,5));
});

test('each silhouette uses three bounded geometry batches with finite coordinates',()=>{
  const library=createBuildingLibrary();assert.equal(library.size,5);
  for(const batch of library.values()){
    assert.equal(batch.length,3);
    for(const geometry of batch){
      assert.ok(geometry.attributes.position.count<1000);
      assert.ok([...geometry.attributes.position.array].every(Number.isFinite));
      geometry.dispose();
    }
  }
});

test('city recycling reuses meshes, materials and the bounded geometry library',()=>{
  const scene=new THREE.Scene(),city=createCity(scene),groups=scene.children.slice(0,20);
  const meshes=groups.flatMap(g=>g.children),materials=meshes.map(m=>m.material),geometries=new Set();
  for(let n=0;n<70;n++){
    city.update({s:n*42,time:n},.2);
    meshes.forEach(mesh=>geometries.add(mesh.geometry));
  }
  assert.deepEqual(groups.flatMap(g=>g.children),meshes);
  assert.deepEqual(meshes.map(m=>m.material),materials);
  assert.equal(geometries.size,15);
  assert.equal(scene.children.length,38);
  assert.ok(city.walkers.every(w=>{
    const center=roadPoint(w.s,0,69*42),position=w.detection.group.position,angle=heading(w.s);
    const offset=(position.x-center.x)*Math.cos(angle)+(position.z-center.z)*Math.sin(angle);
    return Math.abs(offset)>=12.5;
  }));
});
