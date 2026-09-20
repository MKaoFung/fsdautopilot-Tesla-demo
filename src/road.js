import {CubicBezierCurve3,Vector3} from 'three';

export const LANE_WIDTH=3.55,ROAD_HALF_WIDTH=LANE_WIDTH*3,TURN_RADIUS=18;
export const STOP_OFFSET=TURN_RADIUS+3;
const spacing=280,firstJunction=155,radius=TURN_RADIUS;
const directions=[1,-1,0,-1,1,0];
const curve=new CubicBezierCurve3(new Vector3(0,0,0),new Vector3(0,0,-radius*.55228475),new Vector3(radius*(1-.55228475),0,-radius),new Vector3(radius,0,-radius));
curve.arcLengthDivisions=160;
export const turnLength=curve.getLength();
const samples=Array.from({length:257},(_,i)=>{const p=curve.getPointAt(i/256),t=curve.getTangentAt(i/256);return{x:p.x,z:p.z,angle:Math.atan2(t.x,-t.z)};});
samples[0].angle=0;samples[256].angle=Math.PI/2;
const nodes=[{s:0,x:0,z:0,angle:0}];
export const junctionDirection=junction=>directions[Math.round((junction-firstJunction)/spacing)%directions.length]||0;
export const junctionFor=s=>firstJunction+Math.max(0,Math.ceil((s-firstJunction-25)/spacing))*spacing;
export function inJunction(s,junction){return s>junction-radius-4&&s<junction-radius+(junctionDirection(junction)?turnLength:radius*2)+4;}
function ensure(s){
  while(nodes.at(-1).s<s+spacing){
    const i=nodes.length-1,previous=nodes[i],junction=firstJunction+i*spacing,dir=junctionDirection(junction);
    const start=junction-radius,straight=start-previous.s;
    const x=previous.x+Math.sin(previous.angle)*straight,z=previous.z-Math.cos(previous.angle)*straight;
    const end=dir?{x:x+Math.cos(previous.angle)*radius*dir+Math.sin(previous.angle)*radius,z:z+Math.sin(previous.angle)*radius*dir-Math.cos(previous.angle)*radius}: {x:x+Math.sin(previous.angle)*24,z:z-Math.cos(previous.angle)*24};
    nodes.push({s:start+(dir?turnLength:24),...end,angle:previous.angle+dir*Math.PI/2});
  }
}
export function routePose(s){
  ensure(s);
  const index=Math.max(0,Math.floor((s-(firstJunction-radius))/spacing)+1);
  const i=Math.min(index,nodes.length-1),node=nodes[i];
  // The current index's node is the preceding junction exit except inside a turn.
  if(i===0||s>=node.s){const d=s-node.s;return{x:node.x+Math.sin(node.angle)*d,z:node.z-Math.cos(node.angle)*d,angle:node.angle};}
  const prev=nodes[i-1],junction=firstJunction+(i-1)*spacing,start=junction-radius,dir=junctionDirection(junction);
  const approach=start-prev.s,x=prev.x+Math.sin(prev.angle)*approach,z=prev.z-Math.cos(prev.angle)*approach;
  if(!dir){const d=s-start;return{x:x+Math.sin(prev.angle)*d,z:z-Math.cos(prev.angle)*d,angle:prev.angle};}
  const u=Math.max(0,Math.min(256,(s-start)/turnLength*256)),n=Math.min(255,Math.floor(u)),t=u-n;
  const a=samples[n],b=samples[n+1],px=(a.x+(b.x-a.x)*t)*dir,pz=a.z+(b.z-a.z)*t;
  return{x:x+Math.cos(prev.angle)*px-Math.sin(prev.angle)*pz,z:z+Math.sin(prev.angle)*px+Math.cos(prev.angle)*pz,angle:prev.angle+dir*(a.angle+(b.angle-a.angle)*t)};
}
export function junctionPose(junction){
  const p=routePose(junction-radius);
  return{x:p.x+Math.sin(p.angle)*radius,z:p.z-Math.cos(p.angle)*radius,angle:p.angle};
}

// Independent movements through the same intersection, not every car following ego.
export function branchPose(junction,direction,travel,lateral){
  const start=routePose(junction-radius),length=direction?turnLength:radius*2;
  let x=0,z=-travel,angle=0;
  if(direction){
    if(travel>=length){angle=direction*Math.PI/2;x=direction*(radius+travel-length);z=-radius;}
    else {const u=Math.max(0,travel)/length*256,n=Math.min(255,Math.floor(u)),t=u-n,a=samples[n],b=samples[n+1];x=direction*(a.x+(b.x-a.x)*t);z=a.z+(b.z-a.z)*t;angle=direction*(a.angle+(b.angle-a.angle)*t);}
  }
  x+=Math.cos(angle)*lateral;z+=Math.sin(angle)*lateral;
  return{x:start.x+Math.cos(start.angle)*x-Math.sin(start.angle)*z,z:start.z+Math.sin(start.angle)*x+Math.cos(start.angle)*z,angle:start.angle+angle};
}
