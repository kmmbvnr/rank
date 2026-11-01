import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {cpus} from 'node:os';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'), output=process.argv[2];
if(!output || !process.env.RANK314_BASELINE_RUNTIME) throw Error('output and RANK314_BASELINE_RUNTIME required');
const result={node:process.version,cpu:cpus()[0].model,
 revision:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),
 sourceSha256:createHash('sha256').update(readFileSync(resolve(root,'demos/euler/314_mousemoon.ra'))).digest('hex'),
 method:'Three serial fresh processes per timing case, rotating before/after order; imports excluded; parse/execute included; RSS before oracle; diagnostics separate',samples:[],verification:[]};
function run(mode,grid,variant,runtime,diagnostic=false) {
 const child=spawnSync(process.execPath,[resolve(root,'benchmarks/euler314-investigation.mjs'),mode,String(grid),variant],
  {encoding:'utf8',timeout:90000,env:{...process.env,DIAGNOSTICS:diagnostic?'1':'',
   RANK_BENCH_RUNTIME:runtime || resolve(root,'packages/interpreter/out/index.js')}});
 if(child.status!==0) throw Error(child.stderr || String(child.error));
 return JSON.parse(child.stdout);
}
function save() { writeFileSync(output,JSON.stringify(result,null,2)+'\n'); }
for(let round=0;round<3;round++) {
 for(const name of round%2?['after','before']:['before','after']) {
  const variant=name==='before'?'original':'production';
  const runtime=name==='before'?process.env.RANK314_BASELINE_RUNTIME:undefined;
  for(const [mode,grid] of [['compiled',250],['reference',25]]) {
   const sample={name,round,...run(mode,grid,variant,runtime)};
   result.samples.push(sample);save();console.log(JSON.stringify(sample));
  }
 }
}
for(const grid of [1,2,3,5,10,15,25]) for(const mode of ['compiled','reference','exact']) {
 const r=run(mode,grid,'production');result.verification.push({grid,mode,answer:r.answer});save();
}
result.diagnostic=run('compiled',250,'production',undefined,true);
if(result.diagnostic.diagnostics.numberLoops!==500
 || result.diagnostic.diagnostics.numberLoopReadBufferCells!==0
 || result.diagnostic.diagnostics.numberLoopBorrowedRealCells!==94501500
 || result.diagnostic.diagnostics.numberLoopOverflows
 || result.diagnostic.diagnostics.numberFunctionFallbacks) throw Error('full Number path mismatch');
save();console.log('21 oracle comparisons and full Number-path assertion passed');
