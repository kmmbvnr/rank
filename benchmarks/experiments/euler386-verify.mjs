import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {Interpreter} from '../../packages/interpreter/out/index.js';
function oracle(limit){
 let answer=0;
 for(let n=1;n<=limit;n++){
  let rest=n,d=[1];
  for(let p=2;p*p<=rest;p++){
   if(rest%p)continue;
   let e=0;while(rest%p===0){rest/=p;e++;}
   const next=Array(d.length+e).fill(0);
   for(let i=0;i<d.length;i++)for(let j=0;j<=e;j++)next[i+j]+=d[i];
   d=next;
  }
  if(rest>1){const next=Array(d.length+1).fill(0);for(let i=0;i<d.length;i++){next[i]+=d[i];next[i+1]+=d[i];}d=next;}
  answer+=Math.max(...d);
 }
 return String(answer);
}
const limits=[0,1,2,3,4,5,6,7,8,9,10,15,16,17,24,25,26,29,30,31,49,60,64,100,127,128,256,729,999,1024,2000,10000];
let rankChecks=0,jsChecks=0;
const knownFailures=[];
for(const limit of limits){
 const expected=oracle(limit);
 for(const variant of['original','root-bound','convolve','empty-bound','eager-arguments','boundary-fix','delivered']){
  const source=readFileSync(new URL(variant==='delivered'?'../../demos/euler/386_antichain.ra':`euler386-${variant}.ra`,import.meta.url),'utf8');
  for(const compilation of[false,true]){
   const r=new Interpreter(()=>{},{compilation,args:[`--limit=${limit}`]});
   try{r.execute(source);const actual=String((r.variables.get('Answer') ?? r.lastResult));if(!['boundary-fix','delivered'].includes(variant)&&[0,6,7,8].includes(limit)){assert.notEqual(actual,expected);knownFailures.push({variant,compilation,limit,actual,expected});}else{assert.equal(actual,expected,`${variant}:${compilation}:${limit}`);rankChecks++;}}finally{r.dispose();}
  }
 }
 const child=spawnSync(process.execPath,[new URL('euler386-same-algorithm.mjs',import.meta.url).pathname,String(limit)],{encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);assert.equal(String(JSON.parse(child.stdout).answer),expected);jsChecks++;
}
console.log(JSON.stringify({limits,rankChecks,jsChecks,knownFailures}));
