import * as THREE from 'three';

// Cross sections in metres, nose to tail. All panels share these surfaces.
const sections=[
  [-2.36,.66,.70],[-2.25,.78,.85],[-1.95,.84,.92],[-1.5,.89,.945],
  [-1.15,.95,.95],[-.8,.98,.95],[0,1.0,.95],[.8,1.01,.95],
  [1.35,1.02,.945],[1.8,1.01,.91],[2.18,.98,.85],[2.36,.83,.76],
];
const canopy=[[-1.2,.96,.83],[-.95,1.14,.81],[-.6,1.36,.77],[-.15,1.46,.75],
  [.45,1.46,.75],[.85,1.39,.77],[1.2,1.24,.8],[1.55,1.055,.83]];
function sample(table,z){
  let i=0;while(i<table.length-2&&z>table[i+1][0])i++;
  const a=table[i],b=table[i+1],before=table[Math.max(0,i-1)],after=table[Math.min(table.length-1,i+2)];
  const t=THREE.MathUtils.clamp((z-a[0])/(b[0]-a[0]),0,1),h=b[0]-a[0];
  return [1,2].map(k=>{const ma=(b[k]-before[k])/(b[0]-before[0]),mb=(after[k]-a[k])/(after[0]-a[0]);return(2*t**3-3*t*t+1)*a[k]+(t**3-2*t*t+t)*h*ma+(-2*t**3+3*t*t)*b[k]+(t**3-t*t)*h*mb;});
}
function surface(fn,nu=80,nv=32){
  const p=[],indices=[];
  for(let i=0;i<=nu;i++)for(let j=0;j<=nv;j++)p.push(...fn(i/nu,j/nv));
  for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const a=i*(nv+1)+j,b=a+nv+1;indices.push(a,b,a+1,b,b+1,a+1);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
function top(z,theta,lift=0){const [height,width]=sample(canopy,z),base=sample(sections,z)[0]-.012;
  return [Math.sin(theta)*width,base+(height-base)*Math.pow(Math.max(0,Math.cos(theta)),.65)+lift,z];}
const body=surface((u,v)=>{
  const z=-2.36+u*4.72,[deck,width]=sample(sections,z),angle=v*Math.PI*2;
  const x=width*Math.sign(Math.cos(angle))*Math.pow(Math.abs(Math.cos(angle)),.32);
  let bottom=.29;
  for(const wheel of [-1.4,1.4]){const dz=z-wheel;if(Math.abs(dz)<.395)bottom=Math.max(bottom,.35+Math.sqrt(.395**2-dz**2));}
  const y=angle<=Math.PI?deck-.085+.085*Math.pow(Math.sin(angle),.55):bottom+(deck-.085-bottom)*(1-Math.pow(-Math.sin(angle),.25));
  return [x,y,z];
},112,48);
const roof=surface((u,v)=>top(-1.2+u*2.75,(v-.5)*Math.PI),64,36);

export function addFastback(group,paint,glass,dark){
  // Double-sided only for the sheet-like shell; there are no scaled box cabins.
  const shell=paint.clone();shell.side=THREE.DoubleSide;
  group.add(new THREE.Mesh(body,shell),new THREE.Mesh(roof,shell));
  function glassPatch(z0,z1,t0,t1){group.add(new THREE.Mesh(surface((u,v)=>top(z0+(z1-z0)*u,t0+(t1-t0)*v,.009),30,18),glass));}
  glassPatch(-1.12,-.38,-.94,.94);
  glassPatch(-.34,.64,-.92,.92);
  glassPatch(.69,1.47,-.94,.94);
  for(const side of [-1,1]){
    // Curved side glass with a narrow B pillar and substantial painted rear quarter.
    for(const [z0,z1] of [[-.94,.10],[.15,1.12]])glassPatch(z0,z1,side*1.00,side*1.48);
    const sill=new THREE.Mesh(new THREE.BoxGeometry(.028,.075,2.22),dark);sill.position.set(side*.94,.32,0);group.add(sill);
  }
  // Rounded nose/tail caps seal the loft at their actual section dimensions.
  for(const z of [-2.36,2.36]){const [height,width]=sample(sections,z);
    const cap=new THREE.Shape();cap.moveTo(-width,.3);cap.lineTo(width,.3);cap.lineTo(width,height-.085);cap.quadraticCurveTo(0,height+.05,-width,height-.085);cap.closePath();
    const mesh=new THREE.Mesh(new THREE.ShapeGeometry(cap,24),shell);mesh.position.z=z;group.add(mesh);
  }
}
