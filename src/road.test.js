import test from 'node:test';
import assert from 'node:assert/strict';
import {laneX,roadPoint} from './simulation.js';
import {routePose,branchPose,junctionDirection,turnLength,TURN_RADIUS,LANE_WIDTH} from './road.js';
import {createJunction} from './junction.js';

test('all logical ego lanes stay on the right-hand carriageway before and after turns',()=>{
  for(const junction of [155,435,995,1275]){
    const start=junction-TURN_RADIUS,end=start+turnLength;
    for(const s of [start-20,start,end,end+20])for(const lane of [-1,0,1]){
      const median=routePose(s),point=roadPoint(s,laneX(s,lane),0);
      const right=(point.x-median.x)*Math.cos(median.angle)+(point.z-median.z)*Math.sin(median.angle);
      assert.ok(right>LANE_WIDTH*.45,`opposing lane at ${junction} lane ${lane}`);
      const before=roadPoint(s-.01,laneX(s-.01,lane),0),after=roadPoint(s+.01,laneX(s+.01,lane),0);
      const forward=(after.x-before.x)*Math.sin(median.angle)-(after.z-before.z)*Math.cos(median.angle);
      assert.ok(forward>0,'vehicle cannot drive against its outgoing lane');
    }
  }
});
test('NPC lanes select independent left, straight and right connectors on legal outgoing halves',()=>{
  const j=155;
  for(const dir of [-1,0,1]){
    const length=dir?turnLength:TURN_RADIUS*2,offset=(dir+1.5)*LANE_WIDTH;
    const median=branchPose(j,dir,length+12,0),car=branchPose(j,dir,length+12,offset);
    const side=(car.x-median.x)*Math.cos(car.angle)+(car.z-median.z)*Math.sin(car.angle);
    assert.ok(side>0);assert.ok(Math.abs(car.angle-dir*Math.PI/2)<.001);
  }
  assert.equal(junctionDirection(j),1);
  const straight=branchPose(j,0,turnLength+40,LANE_WIDTH*1.5),turn=branchPose(j,1,turnLength+40,LANE_WIDTH*2.5);
  assert.ok(Math.hypot(straight.x-turn.x,straight.z-turn.z)>30);
});
test('signal depth glitches preserve the physical signal state and support structure',()=>{
  const junction=createJunction();let sawJump=false;
  for(let i=0;i<30*60;i++){
    junction.update('red',85,1/60,i/60);
    for(const d of junction.detections){
      sawJump||=Math.abs(d.track.position.z)>.1;
      assert.equal(d.group.position.z,21);assert.equal(d.ghost.visible,false);
      const lamps=d.actual.children.filter(m=>m.geometry?.type==='CircleGeometry');
      assert.equal(lamps[0].material.color.getHex(),0xfa3045);assert.equal(lamps[2].material.color.getHex(),0x27343c);
    }
  }
  assert.ok(sawJump);
});
