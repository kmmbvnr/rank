import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),output=process.argv[2],reference=process.argv[3]==='reference';
const variants=reference?['original','grouped']:['original','grouped','carried','carried-postfix','original-function','grouped-function'];
const cases=variants.map(v=>[v,undefined]);
if(!reference && process.env.RANK316_DECLARED_RUNTIME) cases.push(['carried',process.env.RANK316_DECLARED_RUNTIME]);
const result={node:process.version,cpu:cpus()[0].model,
 revision:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),
 sources:Object.fromEntries(variants.map(v=>[v,createHash('sha256').update(readFileSync(resolve(root,`benchmarks/experiments/euler316-${v}.ra`))).digest('hex')])),
 method:'Three serial fresh processes, rotating case order; imports excluded; parse/execute included; diagnostics separate; process peak RSS',samples:[]};
for(let round=0;round<3;round++) for(let offset=0;offset<cases.length;offset++) {
 const [variant,runtime]=cases[(offset+round)%cases.length];
 const child=spawnSync(process.execPath,[resolve(root,'benchmarks/euler316-investigation.mjs'),reference?'reference':'compiled',reference?'9999':'999999','10000000000000000',variant],
  {encoding:'utf8',timeout:90000,env:{...process.env,...(runtime?{RANK_BENCH_RUNTIME:resolve(runtime)}:{})}});
 if(child.status!==0) throw Error(child.stderr || String(child.error));
 const sample={name:runtime?'declared-prototype':variant,round,...JSON.parse(child.stdout)};result.samples.push(sample);
 writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(sample));
}
