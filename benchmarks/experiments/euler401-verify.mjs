import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const sources=['demos/euler/401_sumsquares.ra',...['array','consumer','shared','scalar'].map(n=>`benchmarks/experiments/euler401-${n}.ra`)];
const limits=[0,1,2,3,4,6,8,9,10,15,16,17,24,25,26,63,64,65,99,100,101,1000,9876];
function oracle(n){let t=0n;for(let d=1;d<=n;d++)t+=BigInt(d)**2n*BigInt(Math.floor(n/d));return t%1000000000n;}
let comparisons=0;
for(const limit of limits){const expected=oracle(limit);
 for(const file of sources)for(const compilation of [false,true]){
  const r=new Interpreter(()=>{},{compilation,args:[`--limit=${limit}`]});
  try{r.execute(readFileSync(file,'utf8'));assert.equal(r.variables.get('Answer'),expected,`${file} ${limit} ${compilation}`);comparisons++;}finally{r.dispose();}
 }
}
console.log(JSON.stringify({limits,variants:sources,comparisons,oracle:'independent divisor enumeration and BigInt sum'}));
