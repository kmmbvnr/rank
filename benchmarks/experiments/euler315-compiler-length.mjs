import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {cpus} from 'node:os';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),output=process.argv[2];
if(!output || !process.env.RANK315_BASELINE_RUNTIME) throw Error('output and RANK315_BASELINE_RUNTIME required');
const result={node:process.version,cpu:cpus()[0].model,
 revision:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),
 method:'Identical guarded captured-len source in both runtimes; serial fresh processes; imports excluded; parse/execute included; diagnostics separate',samples:[]};
function run(name,from,to,variant='captured-len',diagnostic=false) {
 const child=spawnSync(process.execPath,[resolve(root,'benchmarks/euler315-investigation.mjs'),'compiled',String(from),String(to),variant],
  {encoding:'utf8',timeout:90000,env:{...process.env,DIAGNOSTICS:diagnostic?'1':'',
   RANK_BENCH_RUNTIME:name==='before'?process.env.RANK315_BASELINE_RUNTIME:resolve(root,'packages/interpreter/out/index.js')}});
 if(child.status!==0) throw Error(child.stderr || String(child.error));
 const sample={name,...JSON.parse(child.stdout)};
 if(from===100000 && sample.answer!=='181328') throw Error('range answer');
 return sample;
}
function save() {writeFileSync(output,JSON.stringify(result,null,2)+'\n');}
for(let round=0;round<3;round++) for(const name of round%2?['after','before']:['before','after']) {
 const sample={round,...run(name,100000,200000)};result.samples.push(sample);save();console.log(JSON.stringify(sample));
}
if(process.env.RANK315_FULL_BASELINE) {result.fullBaseline=run('before',10000000,20000000);save();}
for(let round=0;round<3;round++) {
 const sample={round,...run('after',10000000,20000000)};result.samples.push(sample);save();console.log(JSON.stringify(sample));
}
result.production=[];
for(let round=0;round<3;round++) result.production.push({round,...run('after',10000000,20000000,'production')});
result.originalControl=[run('before',10000000,20000000,'original'),run('after',10000000,20000000,'original')];
result.diagnostic=run('after',10000000,20000000,'captured-len',true);
if(!result.diagnostic.diagnostics.compiledLoops || result.diagnostic.diagnostics.compilerRejections.some(r=>r.name==='len')
 || result.diagnostic.diagnostics.numberLoopOverflows || result.diagnostic.diagnostics.numberFunctionFallbacks) throw Error('compiled path');
save();console.log('Full guarded-source path and original-source controls passed');
