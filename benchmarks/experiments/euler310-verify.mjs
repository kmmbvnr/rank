import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
import {readArrayItem} from '../../packages/interpreter/out/array-storage.js';

export function oracle(limit) {
 const g=new Uint16Array(limit+1),seen=new Int32Array(Math.floor(Math.sqrt(limit))+2).fill(-1);
 for(let n=1;n<=limit;n++){
  for(let k=1;k*k<=n;k++)seen[g[n-k*k]]=n;
  let mex=0;while(seen[mex]===n)mex++;g[n]=mex;
 }
 const freq=[];for(const v of g)freq[v]=(freq[v]??0)+1;
 // Independent multiplicity counting, without the Rank Burnside formula.
 let answer=0;
 for(let a=0;a<freq.length;a++)for(let b=a;b<freq.length;b++){
  const c=a^b;if(c<b||c>=freq.length)continue;
  const x=freq[a]??0,y=freq[b]??0,z=freq[c]??0;
  answer+=a===c?x*(x+1)*(x+2)/6:a===b?x*(x+1)/2*z:b===c?x*y*(y+1)/2:x*y*z;
 }
 if(limit<=30){
  let brute=0;for(let a=0;a<=limit;a++)for(let b=a;b<=limit;b++)for(let c=b;c<=limit;c++)if((g[a]^g[b]^g[c])===0)brute++;
  assert.equal(answer,brute);
 }
 return {g,answer};
}
let checks=0;
for(const limit of [0,1,2,3,4,7,9,16,29,30,50,100,250,1000]){
 const expected=oracle(limit);
 for(const variant of ['original','scalar','histogram','histogram-array','inline-histogram','production'])for(const mode of ['compiled','reference']){
  const source=readFileSync(new URL(variant==='production'?'../../demos/euler/310_nimsquare.ra':`./euler310-${variant}.ra`,import.meta.url),'utf8').replace('arg Limit integer = 100000',`arg Limit integer = ${limit}`);
  const r=new Interpreter(()=>{},{compilation:mode==='compiled'});
  try{
   r.execute(source);assert.equal(String((r.variables.get('Answer') ?? r.lastResult)),String(expected.answer),`${limit} ${variant} ${mode}`);
   const g=r.variables.get('G');assert.deepEqual(Array.from({length:limit+1},(_,n)=>Number(readArrayItem(g,n))),Array.from(expected.g));checks++;
  }finally{r.dispose();}
 }
}
const full=oracle(100000);assert.equal(full.answer,2586528661783);
console.log(JSON.stringify({checks,fullOracle:full.answer,maxGrundy:Math.max(...full.g),note:'Small answer and every Grundy cell checked in both engines; independent full JS multiplicities'}));
