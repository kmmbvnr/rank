import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter} from '../packages/interpreter/out/index.js';
import {sieveSum,subsetSum} from './euler516-oracle.mjs';
let runs=0;
for(const limit of [0,1,2,5,6,7,10,100,1000,10000,100000]){
 const expected=sieveSum(limit);
 assert.equal(subsetSum(limit).answer,expected,`oracles L=${limit}`);
 for(const compilation of [false,true])for(const variant of ['original','blocked','direct','blocked-direct','final']){
  const path=variant==='final'?'demos/euler/516_5smoothtotients.ra':`benchmarks/experiments/euler516-${variant}.ra`;
  const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const r=new Interpreter(()=>{}, {compilation,args:[`--l=${limit}`]});
  try{r.execute(source);assert.equal((r.variables.get('Answer') ?? r.lastResult),expected,`${variant} ${compilation} L=${limit}`);runs++;}finally{r.dispose();}
 }
}
const full=subsetSum(1e12);assert.equal(full.answer,939087315n);
console.log(JSON.stringify({runs,full},(_,v)=>typeof v==='bigint'?String(v):v));
