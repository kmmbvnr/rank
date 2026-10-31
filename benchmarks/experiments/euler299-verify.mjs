import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const oracle=JSON.parse(readFileSync('benchmarks/baselines/2026-10-31-euler299-oracle.json','utf8'));
const variants=['original','native','symmetry','vector','hybrid','lazy','eager','squares'],checks=[];
for(const variant of variants){
 const source=readFileSync(variant==='original'?'demos/euler/299_threesimilar.ra':`benchmarks/experiments/euler299-${variant}.ra`,'utf8');
 for(const compilation of [false,true])for(let n=1;n<=100;n++){
  const r=new Interpreter(()=>{},{compilation});try{r.execute(source.replace('arg Limit integer = 100000000',`arg Limit integer = ${n}`));const answer=Number(r.variables.get('Answer'));assert.equal(answer,oracle.answers[n],JSON.stringify({variant,compilation,n,answer}));}finally{r.dispose();}
 }
 checks.push({variant,limits:'1..100',modes:['reference','compiled'],checks:200});
}
writeFileSync('benchmarks/baselines/2026-10-31-euler299-verification.json',JSON.stringify({oracle:oracle.method,checks,total:variants.length*200},null,2)+'\n');console.log(`${variants.length*200} independent geometry checks passed`);
