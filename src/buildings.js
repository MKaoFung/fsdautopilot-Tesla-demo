import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

export const BUILDING_TYPES=['storefront','tower','rowhouses','courtyard','canopy'];
const hash=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*t*(10+t*(-15+t*6));};

export function buildingSpec(key){
  const type=BUILDING_TYPES[((key%5)+5)%5];
  const height={storefront:4.2,tower:22,rowhouses:7.2,courtyard:12,canopy:4.1}[type]*(.8+hash(key+4)*.4);
  const width=type==='rowhouses'?10+hash(key+3)*4:8+hash(key+3)*6;
  return {type,width,height,depth:12+hash(key+5)*10,offset:22+width/2+hash(key+2)*4,
    shade:hash(key+13),delay:.15+hash(key+7)*1.4};
}

export function buildingConfidence(key,distance,age,time){
  const acquisition=smooth((age-.15-hash(key+7)*1.4)/1.2);
  const range=smooth((155-distance)/65)*smooth((distance+65)/20);
  const lapse=distance>65&&(time+hash(key)*37)%37<.13;
  return lapse?0:acquisition*range*.83;
}

function pitchedRoof(width,height,depth,x,y,z){
  const triangle=new THREE.Shape();
  triangle.moveTo(-width/2,0);triangle.lineTo(width/2,0);triangle.lineTo(0,height);triangle.closePath();
  const geometry=new THREE.ExtrudeGeometry(triangle,{depth,bevelEnabled:false,steps:1,curveSegments:1});
  geometry.translate(x,y,z-depth/2);return geometry;
}

// Each silhouette is merged once into three material batches, shared by all slots.
export function createBuildingLibrary(){
  const library=new Map();
  for(const type of BUILDING_TYPES){
    const pieces=[[],[],[]];
    const box=(slot,w,h,d,x=0,y=h/2,z=0)=>{
      const g=new THREE.BoxGeometry(w,h,d).toNonIndexed();g.translate(x,y,z);pieces[slot].push(g);
    };
    const band=(y,width=1,depth=1)=>box(1,width,.025,depth,0,y,0);
    if(type==='storefront'){
      box(0,1,.83,1);band(.85,1.03,1.03);
      box(1,.22,.065,1.08,-.57,.66,0);
      box(2,.014,.43,.83,-.507,.36,0);
      for(const z of [-.3,0,.3])box(0,.035,.45,.018,-.524,.36,z);
      box(0,.32,.13,.34,.19,.925,.1);
    }else if(type==='tower'){
      box(0,1,.21,1);box(0,.76,.65,.78,.07,.535,.03);box(0,.45,.14,.49,.10,.93,.03);
      band(.21,1.025,1.025);
      for(const y of [.33,.51,.69,.85]){
        box(2,.768,.025,.788,.07,y,.03);
      }
      box(1,.47,.022,.51,.10,1.01,.03);
    }else if(type==='rowhouses'){
      for(const x of [-.335,0,.335]){
        box(0,.319,.66,.96,x,.33,0);
        pieces[1].push(pitchedRoof(.334,.34,1.02,x,.66,0));
        box(2,.18,.16,.014,x,.46,-.487);box(2,.13,.24,.014,x,.15,-.487);
        box(0,.037,.14,.08,x+.075,.94,.23);
      }
    }else if(type==='courtyard'){
      box(0,.38,1,1,-.31,.5,0);box(0,.62,.63,.37,.19,.315,.315);
      box(1,.405,.03,1.025,-.31,1.01,0);box(1,.64,.03,.39,.19,.64,.315);
      for(const y of [.25,.5,.77])box(2,.014,.055,.85,-.506,y,0);
      box(2,.57,.055,.014,.19,.46,.123);
    }else{
      box(1,1,.065,1,0,.85,0);box(0,.94,.05,.94,0,.79,0);
      for(const x of [-.4,.4])for(const z of [-.41,.41])box(0,.048,.77,.042,x,.385,z);
      box(2,.12,.08,.95,.2,.925,0);box(0,1,.025,1.05,0,.014,0);
    }
    library.set(type,pieces.map(batch=>{
      const merged=mergeGeometries(batch);for(const geometry of batch)geometry.dispose();
      merged.computeBoundingSphere();return merged;
    }));
  }
  return library;
}
