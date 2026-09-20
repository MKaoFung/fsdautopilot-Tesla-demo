// Metres, seconds and m/s throughout. Rendering uses these same road coordinates.
import {routePose,junctionDirection,junctionFor,turnLength,TURN_RADIUS,STOP_OFFSET,LANE_WIDTH,inJunction,branchPose} from './road.js';
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const smooth = t => { t = clamp(t, 0, 1); return t * t * t * (10 + t * (-15 + t * 6)); };
export const center = s => routePose(s).x;
export const heading = s => routePose(s).angle;
export const laneWidth = s => LANE_WIDTH + .18 * Math.sin(s*.014)*smooth((Math.abs(s-junctionFor(s))-55)/40);
// Logical lanes -1/0/+1 all occupy the RIGHT side of the road median.
export const laneX = (s, lane) => (lane+1.5)*laneWidth(s);
export function roadPoint(s, lateral = 0, origin = 0) {
  const p=routePose(s),o=routePose(origin),a=p.angle;
  return { x:p.x-o.x+Math.cos(a)*lateral,z:p.z-o.z+Math.sin(a)*lateral };
}
export function seedRandom(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export class Simulation {
  constructor(seed = 41) {
    this.random = seedRandom(seed);
    this.s = 0; this.time = 0; this.v = 0; this.active = false;
    this.lane = 0; this.lateral = 0; this.targetLane = 0; this.signal = 0;
    this.yaw = -heading(0); this.steering = 0; this.curvature = 0; this.wheelRotation = 0;
    this.manoeuvre = null;
    this.mode = 'standby'; this.phaseTime = 0; this.cooldown = 0;
    this.message = ['AP 可用', '感知就绪，点击激活'];
    this.junction = 155; this.light = 'green'; this.pathLength = 90;
    this.objects = Array.from({length: 10}, (_, id) => ({
      id, s: id === 0 ? 34 : 55 + id * 25, lane: id === 0 ? 0 : id % 3 - 1,
      v: id === 0 ? 5.5 : 8 + this.random() * 7,
      cruise: id === 0 ? 5.5 : 8 + this.random() * 7, kind: 'car',
      model: ['sedan', 'suv', 'hatch', 'van', 'pickup'][id % 5],
    }));
    this.obstacles = [{id: 100, s: 275, lane: 1, v: 0, kind: 'cones'}, {id: 101, s: 835, lane: 0, v: 0, kind: 'stalled'}];
    this.events = []; this.metrics = {changes: 0, stops: 0, cancellations: 0,turns:0};
    this.turnDirection=junctionDirection(this.junction);
    this.pedestrians = Array.from({length:10},(_,i)=>({id:200+i,x:i%2?12:-12,z:(i%2?-15:15)+(Math.floor(i/2)%3-1)*.58,walk:0,walking:false,variant:i}));
    this.crossTraffic = Array.from({length:4}, (_,i)=>({id:300+i,x:(i%2?-1:1)*(27+Math.floor(i/2)*15),direction:i%2?1:-1,z:(i%2?1:-1)*LANE_WIDTH*1.5,v:0,model:['sedan','suv','van','hatch'][i]}));
  }
  record(type) {
    this.events.push({ type, time: this.time, s: this.s, lane: this.lane, target: this.targetLane,direction:this.turnDirection });
    if (this.events.length > 80) this.events.shift();
  }
  setAP(enabled) {
    if (enabled === this.active) return;
    this.active = enabled; this.phaseTime = 0;
    if (enabled) { this.mode = 'checking'; this.message = ['正在检查环境', '正在建立可行驶路径']; }
    else {
      this.manoeuvre = null;
      this.mode = 'standby'; this.signal = 0; this.targetLane = this.lateral;
      this.message = ['AP 已解除', '保持当前位置，平稳减速'];
    }
    this.record(enabled ? 'enabled' : 'disabled');
  }
  front(lane, at = this.s, exclude = null) {
    let best = { gap: Infinity, v: 19.4, object: null };
    for (const obj of [...this.objects, ...this.obstacles]) {
      if (obj === exclude||obj.branch) continue;
      const gap = obj.s - at - (obj.kind === 'car' ? 4.8 : 3.8);
      if (Math.abs(obj.lane - lane) < .58 && obj.s > at && gap < best.gap) best = {gap, v: obj.v, object: obj};
    }
    return best;
  }
  safeLane(lane) {
    if (lane < -1 || lane > 1) return false;
    return [...this.objects, ...this.obstacles].every(obj => {
      if (obj.branch||Math.abs(obj.lane - lane) > .58) return true;
      const gap = obj.s - this.s;
      const futureGap = gap + (obj.v - this.v) * 4;
      const ahead = Math.max(12, this.v * 1.1);
      const behind = Math.max(10, obj.v * 1.2);
      return (gap > ahead && futureGap > 9) || (gap < -behind && futureGap < -9);
    });
  }
  stopDistance() { return this.junction - STOP_OFFSET - this.s - 2.4; }
  mergeDistance(){return this.junction-TURN_RADIUS-10-this.s;}
  mergeReserve(lane=this.lateral){return 14*Math.ceil(Math.max(0,Math.abs(this.turnDirection-lane)-.001));}
  trafficPose(car){return car.branch?branchPose(car.branch.junction,car.branch.direction,car.branch.travel,laneX(car.s,car.lane)): {...roadPoint(car.s,laneX(car.s,car.lane),0),angle:heading(car.s)};}
  changeLength(gap) {
    // Clear the source lane before consuming the available longitudinal space.
    // Reserve five metres beyond that clearance point, even if the leader stops.
    const available = (gap - 5) / .62;
    return available >= 14 ? Math.min(65, Math.max(14, this.v * 4.5), available) : null;
  }
  laneAt(s) {
    if (!this.manoeuvre) return this.lateral;
    const {start,length,from,to} = this.manoeuvre;
    return from + (to - from) * smooth((s-start)/length);
  }
  poseAt(s) {
    const point = d => roadPoint(d,laneX(d,this.laneAt(d)),0);
    const before=point(s-.15), here=point(s), after=point(s+.15);
    const dx=after.x-before.x, dz=after.z-before.z;
    const ddx=(after.x-2*here.x+before.x)/(.15*.15),ddz=(after.z-2*here.z+before.z)/(.15*.15);
    const x1=dx/.3,z1=dz/.3, arc=Math.hypot(x1,z1);
    const curvature=(z1*ddx-x1*ddz)/Math.pow(arc,3);
    return {yaw:Math.atan2(-dx,-dz),curvature,steering:Math.atan(2.8*curvature),arc};
  }
  update(dt) {
    const previousMode = this.mode;
    this.time += dt; this.phaseTime += dt; this.cooldown = Math.max(0, this.cooldown - dt);
    const phase = this.time % 50;
    this.light = phase < 32 ? 'green' : phase < 35 ? 'amber' : phase < 48 ? 'red' : 'green';
    if (this.junction < this.s - 25) {
      if(this.turnDirection)this.metrics.turns++;
      this.junction += 280;this.turnDirection=junctionDirection(this.junction);
      this.crossTraffic.forEach((car,i)=>{car.x=-car.direction*(27+Math.floor(i/2)*15);car.v=0;});
    }
    this.pedestrians.forEach((p,i)=>{
      const t=clamp((phase-35-(i%5)*.2)/11.6,0,1),sign=(i%2?-1:1)*(Math.floor(this.time/50)%2?-1:1);
      p.x=sign*(-12+24*t);p.z=(i%2?-15:15)+(Math.floor(i/2)%3-1)*.58;p.walking=t>0&&t<1;p.walk=sign;p.progress=t;
    });
    this.crossTraffic.forEach(car=>{
      const toLine=-car.direction*car.x-STOP_OFFSET;
      const clearedEgo=!inJunction(this.s,this.junction)&&!this.objects.some(o=>!o.branch&&inJunction(o.s,this.junction));
      const canGo=this.light==='red'&&phase>36&&clearedEgo;
      const alreadyCrossing=toLine<-.5;
      let wanted=canGo||alreadyCrossing?7:Math.min(7,Math.sqrt(4*Math.max(0,toLine-.5)));
      const next=this.crossTraffic.filter(o=>o!==car&&o.direction===car.direction&&(o.x-car.x)*car.direction>0).sort((a,b)=>(a.x-b.x)*car.direction)[0];
      if(next)wanted=Math.min(wanted,Math.max(0,next.v+((next.x-car.x)*car.direction-8)*.55));
      car.v+=clamp(wanted-car.v,-4*dt,2*dt);car.x+=car.direction*car.v*dt;
      if(car.direction*car.x>52){car.x=-car.direction*(46+this.random()*15);car.v=5;}
    });
    const mustStop = this.light !== 'green' && this.stopDistance() > -1;

    // Traffic has its own speed and follows its own leader and the same signal.
    for (const obj of this.objects) {
      if(obj.branch){obj.branch.travel+=obj.v*dt;obj.s+=obj.v*dt;
        if(obj.branch.travel>110){obj.branch=null;obj.s=this.s-50;}else continue;
      }
      let wanted = obj.cruise;
      const lead = this.front(obj.lane, obj.s, obj);
      if (lead.object !== obj && lead.gap < 25) wanted = Math.min(wanted, Math.max(0, lead.v + (lead.gap - 8) * .45));
      const lineGap = this.junction - STOP_OFFSET - obj.s - 2.4;
      if (this.light !== 'green' && lineGap > -1) wanted = Math.min(wanted, Math.sqrt(2 * 3 * Math.max(0, lineGap - .5)));
      if (Math.abs(obj.lane - this.lateral) < .6 && obj.s < this.s && this.s - obj.s < 22)
        wanted = Math.min(wanted, Math.max(0, this.v + (this.s - obj.s - 10) * .4));
      obj.v += clamp(wanted - obj.v, -4 * dt, 2 * dt);
      const travel = Math.min(obj.v * dt, Math.max(0, lead.gap - 2));
      if (travel < obj.v * dt) obj.v = travel / dt;
      obj.s += travel;
      const objectJunction=junctionFor(obj.s),start=objectJunction-TURN_RADIUS;
      if(obj.s>=start&&obj.s-travel<start&&obj.lane!==junctionDirection(objectJunction)){
        obj.branch={junction:objectJunction,direction:obj.lane,travel:obj.s-start};obj.v=Math.min(obj.v,6);
      }
      if (obj.s < this.s - 35 || obj.s > this.s + 350) {
        obj.s = this.s + 170 + this.random() * 150; obj.lane = Math.floor(this.random() * 3) - 1;
        while ([...this.objects,...this.obstacles].some(other => other !== obj && other.lane === obj.lane && Math.abs(other.s - obj.s) < 25)) obj.s += 27;
        obj.cruise = 5 + this.random() * 12; obj.v = obj.cruise;
      }
    }
    this.obstacles.forEach(o => { if (o.s < this.s - 25) { o.s = Math.max(o.s + 420, this.s + 360); o.lane = Math.floor(this.random() * 3) - 1;
      const junctionOffset=((o.s-155+140)%280+280)%280-140;
      if(Math.abs(junctionOffset)<110)o.s+=110-junctionOffset;
      while (this.objects.some(car=>car.lane===o.lane&&Math.abs(car.s-o.s)<30)) o.s+=35;
      const required=junctionDirection(junctionFor(o.s));if(o.lane===required)o.lane=required===1?0:1;
    } });

    let desired = 19.4;
    if (!this.active || this.mode === 'checking') {
      desired = 0;
      if (this.active && this.phaseTime >= .75) {
        this.mode = 'cruise'; this.phaseTime = 0;
        if (Math.abs(this.lateral - Math.round(this.lateral)) > .001) {
          const nearest = Math.round(this.lateral);
          this.targetLane = nearest;
          if (this.safeLane(nearest)) {
            this.mode = 'signalling'; this.signal = Math.sign(nearest - this.lateral); this.record('signal');
          }
        }
      }
    } else {
      const lead = this.front(this.lane);
      const sourceLength = this.changeLength(lead.gap);
      const targetSpace = this.mode === 'signalling' ? this.front(this.targetLane).gap - 20 : Infinity;
      const fullLength = sourceLength === null || targetSpace < 14 ? null : Math.min(sourceLength,targetSpace);
      const length = fullLength === null ? null : fullLength * (this.mode === 'signalling' ? Math.max(.2, Math.sqrt(Math.abs(this.targetLane-this.lateral))) : 1);
      const junctionGap=this.junction-this.s;
      const routing=junctionGap>TURN_RADIUS&&junctionGap<280;
      const requiredLane=this.turnDirection;
      const routeNeedsMerge=routing&&Math.abs(this.lateral-requiredLane)>.001;
      const nearJunction = inJunction(this.s,this.junction) || (mustStop&&this.stopDistance()<(length||14)+4);
      if (this.mode === 'signalling') {
        const mergeRoom=junctionGap>TURN_RADIUS?this.junction-TURN_RADIUS-7-this.s:Infinity;
        const remainingReserve=routeNeedsMerge?this.mergeReserve(this.targetLane):0;
        const availableLength=mergeRoom-remainingReserve;
        const awayFromRoute=routing&&Math.abs(this.targetLane-requiredLane)>Math.abs(this.lane-requiredLane);
        if (!this.safeLane(this.targetLane) || length === null || nearJunction || availableLength<14 || awayFromRoute) {
          this.targetLane = this.lane; this.signal = 0; this.mode = 'following'; this.cooldown = 2;
          this.metrics.cancellations++; this.record('cancelled');
        } else if (this.phaseTime >= 2.2) {
          this.mode = 'changing'; this.phaseTime = 0; this.fromLane = this.lateral; this.record('changing');
          this.manoeuvre = {start:this.s,length:Math.min(length,availableLength),from:this.lateral,to:this.targetLane};
        }
      } else if (this.mode === 'changing') {
        // A spatial trajectory cannot advance sideways while the car is stationary.
        this.lateral = this.laneAt(this.s);
        if (this.s >= this.manoeuvre.start + this.manoeuvre.length || (Math.abs(this.lateral-this.targetLane)<.001 && this.s-this.manoeuvre.start>this.manoeuvre.length*.95)) {
          this.lane = this.targetLane; this.lateral = this.lane; this.signal = 0;
          this.manoeuvre = null;
          this.mode = 'cruise'; this.cooldown = 5; this.metrics.changes++; this.record('changed');
        }
      } else {
        this.mode = lead.gap < Math.max(60, this.v * 3.8) ? 'following' : 'cruise';
        if(routeNeedsMerge&&length!==null&&!nearJunction&&this.junction-TURN_RADIUS-7-this.s>=14){
          const adjacent=this.lane+Math.sign(requiredLane-this.lane);
          if(this.safeLane(adjacent)&&this.front(adjacent).gap>length+20){this.targetLane=adjacent;this.signal=Math.sign(adjacent-this.lateral);this.mode='signalling';this.phaseTime=0;this.record('signal');}
        }
        if (!routeNeedsMerge&&(!routing||junctionGap>205)&&this.mode === 'following' && length !== null && (this.v > 5 || lead.v < 1) && !nearJunction && this.cooldown === 0 && lead.v < 16) {
          const candidates = [this.lane - 1, this.lane + 1].filter(l => this.safeLane(l) && this.front(l).gap > Math.max(lead.gap + 15, length + 20));
          if (candidates.length) {
            const upcomingLane=junctionDirection(this.junction+(junctionGap<0?280:0));
            this.targetLane = candidates.sort((a, b) => Math.abs(a-upcomingLane)-Math.abs(b-upcomingLane)||this.front(b).gap-this.front(a).gap)[0];
            this.signal = Math.sign(this.targetLane - this.lane); this.mode = 'signalling'; this.phaseTime = 0; this.record('signal');
          }
        }
      }
      // Both occupied lanes constrain speed during the lateral manoeuvre.
      const occupied = this.mode === 'changing' ? [this.lane, this.targetLane].filter(l=>Math.abs(l-this.lateral)<.65) : [this.lane];
      for (const l of occupied) {
        const front = this.front(l);
        const waitingForMerge=routeNeedsMerge&&this.mode!=='changing';
        const normalReserve=inJunction(this.s,this.junction)?10:18;
        const desiredGap = this.mode==='changing'&&l===this.lane?2.5+this.v*.7:(waitingForMerge?38:normalReserve)+this.v*1.05;
        if (front.gap < 80) desired = Math.min(desired, Math.max(0, front.v + (front.gap - desiredGap) * .55));
        const reserve=this.mode==='changing'&&l===this.lane?2:waitingForMerge?38:normalReserve;
        desired = Math.min(desired, Math.sqrt(front.v*front.v+2*3.2*Math.max(0,front.gap-reserve)));
      }
      if (mustStop) desired = Math.min(desired, Math.sqrt(2 * 3.2 * Math.max(0, this.stopDistance() - 2.2)));
      // Keep room for every remaining adjacent merge, including the second step
      // when a leftmost-lane vehicle needs the right-turn lane (or vice versa).
      if(routeNeedsMerge&&this.mode!=='changing'){
        const adjacent=this.lane+Math.sign(requiredLane-this.lane),targetLead=this.front(adjacent);
        desired=Math.min(desired,Math.sqrt(2*3*Math.max(0,this.mergeDistance()-this.mergeReserve())),7,
          Math.max(0,targetLead.v+(targetLead.gap-38-this.v*1.05)*.55));
      }
      desired = Math.min(desired,Math.sqrt(2.1/Math.max(.0001,Math.abs(this.poseAt(this.s+4).curvature))));
      if(this.turnDirection&&this.junction-this.s<38&&this.junction-this.s>-turnLength)desired=Math.min(desired,6.2);
      if (mustStop && this.stopDistance() < 65) {
        if (this.v < .1 && previousMode !== 'waiting') { this.metrics.stops++; this.record('stopped'); }
        if (!['changing','signalling'].includes(this.mode)) this.mode = this.v < .1 ? 'waiting' : 'braking';
      }
      const labels = {
        cruise: ['AP 已激活', '沿车道中心行驶'], following: ['正在跟车', '根据前车距离调节速度'],
        signalling: ['准备变道', `已确认${this.signal < 0 ? '左' : '右'}侧间距，转向灯开启`],
        changing: ['正在变道', '持续监测前后车辆'], braking: ['前方红灯', '路径收至停止线，正在减速'],
        waiting: ['等待绿灯', '车辆已停稳'],
      };
      this.message = labels[this.mode] || labels.cruise;
      if(routeNeedsMerge&&!['changing','signalling','braking','waiting'].includes(this.mode))
        this.message=['等待变道间距',`提前进入${requiredLane<0?'左转':requiredLane>0?'右转':'直行'}车道`];
      if(!['changing','signalling'].includes(this.mode)){
        const approaching=this.junction-this.s<44&&this.junction-this.s>TURN_RADIUS-turnLength;
        this.signal=approaching?this.turnDirection:0;
        if(approaching&&this.turnDirection&&!routeNeedsMerge&&this.mode!=='waiting'&&this.mode!=='braking')this.message=['路口'+(this.turnDirection>0?'右转':'左转'),'沿规划路径转弯'];
      }
    }
    this.v = Math.max(0, this.v + clamp(desired - this.v, -4.5 * dt, 2.6 * dt));
    const plannedAdvance = this.v * dt / this.poseAt(this.s).arc;
    let advance = plannedAdvance;
    // Hard constraints guard against a late signal transition or an unexpectedly close obstacle.
    if (mustStop) advance = Math.min(advance, Math.max(0, this.stopDistance() - 1.8));
    const needsLane=this.s<this.junction-TURN_RADIUS&&Math.abs(this.lateral-this.turnDirection)>.001;
    if(needsLane&&this.mode!=='changing')advance=Math.min(advance,Math.max(0,this.mergeDistance()-this.mergeReserve()+1));
    if(needsLane&&this.s+advance>=this.junction-TURN_RADIUS)advance=Math.max(0,this.junction-TURN_RADIUS-this.s-.01);
    const entering=this.s<this.junction-TURN_RADIUS&&this.s+advance>=this.junction-TURN_RADIUS;
    if(entering)this.record('entered-junction');
    for (const l of this.mode === 'changing' ? [this.lane, this.targetLane].filter(l=>Math.abs(l-this.lateral)<.65) : [this.lateral]) {
      const front = this.front(l);
      advance = Math.min(advance, Math.max(0, front.gap - 1.5));
    }
    if (advance < plannedAdvance - .00001) this.v *= advance / Math.max(.00001,plannedAdvance);
    this.s += advance;
    if (this.manoeuvre) this.lateral = this.laneAt(this.s);
    const pose=this.poseAt(this.s);this.yaw=pose.yaw;this.steering=pose.steering;this.curvature=pose.curvature;
    this.wheelRotation += this.v * dt / .34;
    let length = clamp(24 + this.v * 3.7, 24, 100);
    const planningLane = ['signalling', 'changing'].includes(this.mode) ? this.targetLane : this.lateral;
    length = Math.min(length, this.front(planningLane).gap - 2);
    if (mustStop) length = Math.min(length, this.stopDistance() + 2.25);
    if(needsLane&&this.mode!=='changing'&&this.mode!=='signalling')length=Math.min(length,Math.max(2.4,this.mergeDistance()-this.mergeReserve()+1));
    // Smooth extension, immediate clipping at physical constraints.
    this.pathLength = Math.min(length, this.pathLength + dt * 22);
    this.pathLength = Math.max(.3, this.pathLength);
    if (!this.active && this.v < .05) this.message = ['AP 可用', '车辆已停稳，点击重新激活'];
  }
  pathAt(distance) {
    const changing = ['signalling', 'changing'].includes(this.mode);
    const target = changing ? this.targetLane : this.lateral;
    const lane = this.manoeuvre ? this.laneAt(this.s+distance) : this.lateral + (target - this.lateral) * smooth((distance - Math.max(3,this.v*1.4)) / Math.max(34, this.v * 4.5));
    const s = this.s + distance;
    const bend = Math.abs(heading(s + 5) - heading(s - 5));
    const junctionProximity = Math.max(0, 1 - Math.abs(s - this.junction) / 22);
    const halfWidth = (.65 - .10 * junctionProximity) * clamp(1 - bend * .3, .85, 1);
    return { s, lane, lateral: laneX(s, lane), halfWidth };
  }
}
