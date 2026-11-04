import assert from 'node:assert/strict';
import {DensePrimeSieve} from '../../packages/interpreter/out/runtime/dense-prime-sieve.js';
const limit=Number(process.argv[2]||100000000);
const start=performance.now();
const sieve=new DensePrimeSieve(limit);
const ps=[];
for(let p=2;p<=Math.max(3,Math.floor(Math.sqrt(limit)));p++)if(sieve.contains(p))ps.push(p);
let countCalls=0,rootCalls=0,patterns=0;
function root(n,e){
 rootCalls++;
 if(e===1)return n;
 if(e===2)return Math.floor(Math.sqrt(n));
 let lo=1,hi=Math.floor(Math.sqrt(n));
 while(lo<hi){
  const mid=Math.floor((lo+hi+1)/2);
  let power=1,large=false;
  for(let i=0;i<e;i++){
   if(power>Math.floor(n/mid)){large=true;break;}
   power*=mid;
  }
  if(large)hi=mid-1;else lo=mid;
 }
 return lo;
}
function width(es){
 let d=[1];
 for(const e of es){
  const next=Array(d.length+e).fill(0);
  for(let i=0;i<d.length;i++)for(let j=0;j<=e;j++)next[i+j]+=d[i];
  d=next;
 }
 return Math.max(...d);
}
function cnt(es,pos,lim,low,used){
 countCalls++;
 const e=es[pos];
 if(pos===es.length-1){
  const top=root(lim,e);
  let total=sieve.count(top)-sieve.count(low-1);
  for(const u of used)if(u>=low&&u<=top)total--;
  return total;
 }
 let same=1;
 while(pos+same<es.length&&es[pos+same]===e)same++;
 const top=root(lim,e*same);
 let total=0;
 for(const p of ps){
  if(p<low)continue;
  if(p>top)break;
  if(used.includes(p))continue;
  const next=[...used,p],pos2=pos+1;
  const newLow=pos2<es.length&&es[pos2]===e?p+1:2;
  total+=cnt(es,pos2,Math.floor(lim/p**e),newLow,next);
 }
 return total;
}
function pats(i,last,v,es){
 if(i>=ps.length)return 0;
 let pow=1,total=0;
 for(let e=1;e<=last;e++){
  pow*=ps[i];
  const next=v*pow;
  if(next>limit)break;
  patterns++;
  const more=[...es,e];
  total+=width(more)*cnt(more,0,limit,2,[]);
  total+=pats(i+1,e,next,more);
 }
 return total;
}
const answer=limit===0?0:1+pats(0,26,1,[]);
const ms=performance.now()-start;
const expected={1:1,2:2,10:12,100:178,1000:2385,10000:29860,100000:357503,1000000:4153927,100000000:528755790}[limit];
if(expected!==undefined)assert.equal(answer,expected);
console.log(JSON.stringify({kind:'js-same-algorithm',limit,answer,ms,rssMiB:process.resourceUsage().maxRSS/1024,countCalls,rootCalls,patterns}));
