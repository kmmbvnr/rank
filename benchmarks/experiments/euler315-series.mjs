import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),output=process.argv[2];
const reference=process.argv[3]==='reference';
const variants=process.env.RANK315_DELIVERY
 ? (reference?['original','production']:['original','captured-len','production'])
 : (reference?['original','split']:['original','overlap','table','split','array','chunk1000']);
const cases=variants.map(variant=>[variant,undefined]);
if(!reference && process.env.RANK315_FAST_POPCOUNT) cases.push(['original',process.env.RANK315_FAST_POPCOUNT]);
const result={node:process.version,cpu:cpus()[0].model,
 revision:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),
 sources:Object.fromEntries(variants.map(v=>[v,createHash('sha256').update(readFileSync(resolve(root,v==='production'?'demos/euler/315_digitalclocks.ra':`benchmarks/experiments/euler315-${v}.ra`))).digest('hex')])),
 method:'Three serial fresh processes, rotating case order; import excluded; parse/execute included; no diagnostics; process peak RSS',samples:[]};
for(let round=0;round<3;round++) for(let offset=0;offset<cases.length;offset++) {
 const [variant,runtime]=cases[(offset+round)%cases.length];
 const child=spawnSync(process.execPath,[resolve(root,'benchmarks/euler315-investigation.mjs'),reference?'reference':'compiled',reference?'100000':'10000000',reference?'200000':'20000000',variant],
  {encoding:'utf8',timeout:90000,env:{...process.env,...(runtime?{RANK_BENCH_RUNTIME:resolve(runtime)}:{})}});
 if(child.status!==0) throw Error(child.stderr || String(child.error));
 const sample={name:runtime?'fast-popcount':variant,round,...JSON.parse(child.stdout)};result.samples.push(sample);
 writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(sample));
}
