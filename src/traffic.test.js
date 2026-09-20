import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from './simulation.js';
import {TURN_RADIUS,turnLength} from './road.js';

function step(sim,seconds){for(let i=0;i<seconds*60;i++)sim.update(1/60);}

test('a blocked required lane waits upstream, then completes both adjacent merges before turning',()=>{
  const sim=new Simulation();sim.objects=[];
  sim.lane=sim.lateral=sim.targetLane=-1;
  sim.obstacles=[{id:99,s:18,lane:0,v:0,kind:'stalled'}];
  sim.setAP(true);step(sim,12);
  assert.ok(sim.s<2);assert.equal(sim.lateral,-1);assert.equal(sim.v,0);
  assert.ok(sim.s+sim.mergeReserve()+10<sim.junction-TURN_RADIUS);
  sim.obstacles=[];
  for(let i=0;i<60*60&&!sim.events.some(e=>e.type==='entered-junction');i++)sim.update(1/60);
  const entry=sim.events.find(e=>e.type==='entered-junction');
  assert.ok(entry);assert.equal(entry.lane,1);assert.equal(entry.target,1);
  assert.equal(sim.metrics.changes,2);assert.equal(sim.manoeuvre,null);
});

test('twelve fifteen-minute routes enter only from designated lanes and never merge inside a junction',()=>{
  for(const seed of [1,2,3,4,5,6,7,8,9,10,41,732]){
    const sim=new Simulation(seed);sim.setAP(true);
    let stopped=0,entries=0;
    const directions=new Set();
    for(let i=0;i<900*60;i++){
      const start=sim.junction-TURN_RADIUS,end=start+(sim.turnDirection?turnLength:TURN_RADIUS*2);
      const before=sim.s;
      sim.update(1/60);
      stopped=sim.v<.1?stopped+1:0;
      assert.ok(stopped<35*60,`stalled seed=${seed}, s=${sim.s}, lane=${sim.lateral}, mode=${sim.mode}`);
      if(sim.s>=start&&sim.s<=end){
        assert.equal(sim.manoeuvre,null,`merging inside intersection seed=${seed}, s=${sim.s}`);
        assert.equal(sim.lateral,sim.turnDirection,`wrong entry lane seed=${seed}, s=${sim.s}`);
      }
      if(before<start&&sim.s>=start){
        assert.equal(sim.lane,sim.turnDirection);assert.equal(sim.targetLane,sim.turnDirection);
        if(sim.turnDirection)assert.equal(sim.signal,sim.turnDirection);
        entries++;directions.add(sim.turnDirection);
      }
      for(const other of [...sim.objects,...sim.obstacles])
        if(!other.branch&&Math.abs(other.lane-sim.lateral)<.55)
          assert.ok(Math.abs(other.s-sim.s)>4,`overlap seed=${seed}, s=${sim.s}, other=${other.id}`);
    }
    assert.ok(sim.s>6000,`insufficient progress seed=${seed}, s=${sim.s}`);
    assert.ok(entries>15);assert.ok(directions.has(-1)&&directions.has(1));
  }
});
