import * as THREE from 'three';

export function createPedestrian(variant=0){
  const root=new THREE.Group();
  const mat=new THREE.MeshStandardMaterial({color:[0x848b91,0x616c74,0x979a96,0x5c6467,0xa5a7a2,0x767977][variant%6],roughness:.85});
  const skin=new THREE.MeshStandardMaterial({color:0xa7a8a5,roughness:.95});
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.17,.42,5,10),mat);torso.position.y=1.1;root.add(torso);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.13,12,10),skin);head.position.y=1.61;root.add(head);
  const hips=new THREE.Group();hips.position.y=.85;root.add(hips);
  const legs=[],arms=[];
  for(const side of [-1,1]){
    const leg=new THREE.Group();leg.position.x=side*.1;
    const upper=new THREE.Mesh(new THREE.CapsuleGeometry(.067,.27,4,8),mat);upper.position.y=-.18;leg.add(upper);
    const knee=new THREE.Group();knee.position.y=-.37;
    const lower=new THREE.Mesh(new THREE.CapsuleGeometry(.052,.27,4,8),mat);lower.position.y=-.18;knee.add(lower);
    const foot=new THREE.Mesh(new THREE.BoxGeometry(.12,.09,.22),mat);foot.position.set(0,-.36,-.05);knee.add(foot);leg.add(knee);hips.add(leg);legs.push({leg,knee});
    const arm=new THREE.Group();arm.position.set(side*.23,1.29,0);
    const limb=new THREE.Mesh(new THREE.CapsuleGeometry(.045,.43,4,8),mat);limb.position.y=-.23;arm.add(limb);root.add(arm);arms.push(arm);
  }
  const height=[1,.92,1.06,.82,.98,1.02][variant%6],width=[1,1.16,.88,.8,1.07,.92][variant%6];root.scale.set(width,height,width);
  if(variant%3===0){const bag=new THREE.Mesh(new THREE.CapsuleGeometry(.14,.22,4,8),mat);bag.position.set(0,1.1,.19);root.add(bag);}
  if(variant%4===1){const coat=new THREE.Mesh(new THREE.CylinderGeometry(.16,.24,.5,10),mat);coat.position.y=.92;root.add(coat);}
  if(variant%5===2){const bag=new THREE.Mesh(new THREE.BoxGeometry(.17,.25,.23),mat);bag.position.set(.29,.67,0);root.add(bag);}
  root.userData={legs,arms};return root;
}
export function animatePedestrian(root,phase,walking){
  const amplitude=walking?.46:0;
  root.userData.legs.forEach(({leg,knee},i)=>{const wave=Math.sin(phase+i*Math.PI);leg.rotation.x=wave*amplitude;knee.rotation.x=-Math.max(0,-wave)*amplitude;});
  root.userData.arms.forEach((arm,i)=>arm.rotation.x=-Math.sin(phase+i*Math.PI)*amplitude*.7);
  root.position.y=walking?.02+Math.abs(Math.sin(phase*2))*.015:.02;
}
