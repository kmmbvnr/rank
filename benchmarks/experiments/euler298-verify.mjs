import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const oracle=JSON.parse(readFileSync('benchmarks/baselines/2026-10-31-euler298-oracle.json','utf8'));
const shippingOnly=process.argv.includes('--shipping');
const samples=[];
const graphEdges=(codes,from,to,delta,weight)=>from.map((f,i)=>[codes[f],codes[to[i]],delta[i],weight[i]].join(':')).sort();
const expectedGraph=oracle.transitions.flatMap((es,i)=>es.map(e=>[oracle.codes[i],oracle.codes[e.to],e.delta,e.weight].join(':'))).sort();
function run(mode,variant,turns,graph=false,policy='cow'){
 const args=[...(mode==='compiled' && policy!=='none'?['--import',`./benchmarks/experiments/euler298-alias-${policy}.mjs`]:[]),'benchmarks/euler298-investigation.mjs',mode,variant,String(turns)];
 const p=spawnSync(process.execPath,args,{encoding:'utf8',timeout:30000,env:{...process.env,...(graph?{GRAPH:'1'}:{})}});assert.equal(p.status,0,p.stderr);const row=JSON.parse(p.stdout);if(variant==='exact'||variant==='shipping')assert.equal(row.correct,true,JSON.stringify(row));
 if(graph){const g=row.graph;assert.deepEqual(graphEdges(g.Sc,g.Tf,g.Tt,g.Td,g.Tw),expectedGraph);delete row.graph;row.graphVerified=true;}
 samples.push(row);
}
for(const variant of (shippingOnly?['shipping']:['original','skip','exact'])){
 for(let t=0;t<=50;t++)run('compiled',variant,t,t===0,shippingOnly?'none':'cow');
 for(const t of [0,5,7,8,9,10,20,22,50])run('reference',variant,t,t===0);
}
if(!shippingOnly)run('compiled','original',50,false,'guard');
writeFileSync(`benchmarks/baselines/2026-10-31-euler298-${shippingOnly?'delivery-verification':'verification'}.json`,JSON.stringify({oracle:oracle.method,samples},null,2)+'\n');console.log(JSON.stringify({checks:samples.length,graphChecks:samples.filter(x=>x.graphVerified).length,roundingMismatches:samples.filter(x=>!x.correct).map(x=>({mode:x.mode,variant:x.variant,turns:x.turns,answer:x.answer}))}));
