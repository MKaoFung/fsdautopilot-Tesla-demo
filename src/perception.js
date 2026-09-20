import * as THREE from 'three';

// Synthetic display-only tracking errors, not a reproduction of Tesla's perception algorithm.
let nextTrack=0;
export function trackingState(id,distance,time,age=10,kind='vehicle'){
  const period=19+(id%5)*1.3,clock=Math.max(0,time)+id*3.713;
  const cycle=Math.floor(clock/period),phase=clock%period;
  // Close objects remain stable; mid-range tracks fail only once every three cycles.
  const vulnerable=distance>22&&distance<110&&(distance>=48||(cycle+id)%3===0);
  let visible=age>=.24||Math.floor(age/.06)%2===1;
  let state=age<.24?'acquiring':'stable',x=0,z=0,yaw=0,duplicate=false;
  if(vulnerable&&phase<.16){visible=false;state='lost';}
  else if(vulnerable&&phase<.34){visible=Math.floor((phase-.16)/.055)%2===0;state='flicker';}
  else if(vulnerable&&phase<.90){
    state='offset';
    const step=Math.min(3,Math.floor((phase-.34)/.14));
    const depth=[1,-.85,.55,-.3][step],side=[1,-.5,.6,0][step];
    const range=THREE.MathUtils.clamp((distance-22)/70,0,1),sign=id%2?1:-1;
    const scale=kind==='signal'?.45:kind==='pedestrian'?.4:1;
    z=depth*(.9+2.1*range)*scale*sign;
    x=side*(.12+.20*range)*scale*sign;
    yaw=kind==='signal'?0:side*.025*sign;
    duplicate=kind!=='signal'&&step===1;
  }
  else if(vulnerable&&phase<1.06)state='reacquired';
  return {visible,state,x,z,yaw,duplicate};
}
export function laneTrackingState(id,time){
  const phase=(time+id*8.3)%23;
  return {lost:phase>7&&phase<7.28,offset:phase>=7.28&&phase<7.65?(id?-.24:.24):0};
}
export function createDetection(actual,wrong=null,label='',options={}){
  const kind=options.kind??'vehicle',ghostEnabled=options.ghost??kind!=='signal';
  const group=new THREE.Group(),track=new THREE.Group();group.add(track);track.add(actual);
  const ghost=ghostEnabled?actual.clone(true):new THREE.Group();
  if(ghostEnabled){
    const ghostMat=new THREE.MeshBasicMaterial({color:0x858e93,transparent:true,opacity:.25,depthWrite:false});
    ghost.traverse(o=>{if(o.isMesh){o.material=ghostMat;o.castShadow=false;}});
  }
  ghost.visible=false;group.add(ghost);
  if(wrong){track.add(wrong);wrong.visible=false;}
  return {id:nextTrack++,kind,ghostEnabled,group,track,ghost,actual,wrong,label,age:0,corrected:false,eventTime:-100,state:'stable',misclassified:false,lastDistance:1000};
}
export function updateDetection(d,distance,dt,time){
  if(distance>125||distance<-25){
    d.group.visible=false;d.ghost.visible=false;d.age=0;d.corrected=false;
    d.track.position.set(0,0,0);d.track.rotation.y=0;
    d.lastDistance=distance;d.state='outside';return null;
  }
  if(Math.abs(distance-d.lastDistance)>35){d.age=0;d.corrected=false;}
  d.lastDistance=distance;d.group.visible=true;d.age+=dt;
  const state=trackingState(d.id,distance,time,d.age,d.kind);
  d.track.visible=state.visible;d.track.position.set(state.x,0,state.z);d.track.rotation.y=state.yaw;d.state=state.state;
  if(d.wrong&&distance<43&&!d.corrected){d.corrected=true;d.eventTime=time;}
  d.misclassified=Boolean(d.wrong&&!d.corrected);d.actual.visible=!d.misclassified;
  if(d.wrong)d.wrong.visible=d.misclassified;
  d.ghost.visible=d.ghostEnabled&&state.duplicate&&!d.misclassified;
  d.ghost.position.set(-state.x*.6,0,-state.z*.45);d.ghost.rotation.y=-state.yaw*.4;
  if(time-d.eventTime<.12){d.track.visible=false;d.state='reacquired';}
  return time-d.eventTime<1.3?d.label:null;
}
