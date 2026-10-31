import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Interpreter} from '../../packages/interpreter/out/index.js';
import {contactMaps,maximalMaps} from './euler300-contacts.mjs';
const records=[];
// Score every protein independently in JS, using extracted non-chain contacts.
for(let n=2;n<=12;n++) {
 const maps=contactMaps(n),maximal=maximalMaps(maps);
 if(n<=10)assert.deepEqual(new Set(contactMaps(n,true)),new Set(maps));
 function bestScores(keys){
  const best=new Uint8Array(2**n);
  for(const key of keys){const pairs=[];for(let i=0;i<n;i++)for(let j=i+2;j<n;j++)if(key&(1n<<BigInt(i*n+j)))pairs.push((1<<i)|(1<<j));
   for(let mask=0;mask<best.length;mask++){let score=0;for(const pair of pairs)if((mask&pair)===pair)score++;best[mask]=Math.max(best[mask],score);}
  }
  return best;
 }
 const original=bestScores(maps),pruned=bestScores(maximal);assert.deepEqual(original,pruned);
 let total=0;for(let mask=0;mask<original.length;mask++){let score=original[mask];for(let i=0;i<n-1;i++)if((mask&(3<<i))===(3<<i))score++;total+=score;}
 for(const variant of ['original','maximal','maximal-scalar','production'])for(const compilation of [false,true]){
  const source=readFileSync(variant==='production'?'demos/euler/300_proteinfolding.ra':`benchmarks/experiments/euler300-${variant}.ra`,'utf8').replace('arg N integer = 15',`arg N integer = ${n}`);
  const r=new Interpreter(()=>{},{compilation});try{r.execute(source);assert.equal(Number(r.variables.get('Answer')),total/2**n,JSON.stringify({n,variant,compilation}));assert.deepEqual(Array.from(r.variables.get('Best').items,Number),Array.from(original),JSON.stringify({n,variant,compilation,field:'Best'}));if(variant!=='original')assert.equal(Number(r.variables.get('Count')),maximal.length);}finally{r.dispose();}
 }
 records.push({n,maps:maps.length,maximal:maximal.length,proteins:2**n,numerator:total,answer:total/2**n,rankChecks:8});
}
const fixtures=[];
for(const variant of ['original','maximal','maximal-scalar','production'])for(const compilation of [false,true]){
 const source=readFileSync(variant==='production'?'demos/euler/300_proteinfolding.ra':`benchmarks/experiments/euler300-${variant}.ra`,'utf8');
 const r=new Interpreter(()=>{},{compilation,testing:true,sourceId:resolve('demos/euler/300_proteinfolding_test.ra'),loadModule(){return {id:resolve('demos/euler/300_proteinfolding.ra'),source};}});
 try{r.execute(readFileSync('demos/euler/300_proteinfolding_test.ra','utf8'));assert.equal(r.testResults.length,2);assert(r.testResults.every(t=>t.passed),JSON.stringify(r.testResults));fixtures.push({variant,compilation,passed:2});}finally{r.dispose();}
}
writeFileSync('benchmarks/baselines/2026-10-31-euler300-verification.json',JSON.stringify({records,rankChecks:records.length*8,fixtures},null,2)+'\n');console.log(`${records.length*8} Rank answers and every protein's pruning invariance checked for N=2..12`);
