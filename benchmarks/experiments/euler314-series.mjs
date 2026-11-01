import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const [output,borrow,arity]=process.argv.slice(2);
const cases=[['current','original',undefined],['continuous','continuous',undefined],
 ['borrow','original',borrow],['borrow-continuous','continuous',borrow],
 ['borrow-inline','inline',borrow],['borrow-arity','original',arity]];
if(process.env.RANK314_CACHE_ONLY && process.env.RANK314_CACHE_BORROW) {
 cases.splice(2,4,
  ['cache','original',process.env.RANK314_CACHE_ONLY],
  ['cache-continuous','continuous',process.env.RANK314_CACHE_ONLY],
  ['cache-borrow','original',process.env.RANK314_CACHE_BORROW],
  ['cache-borrow-continuous','continuous',process.env.RANK314_CACHE_BORROW]);
}
const results={node:process.version,cpu:cpus()[0].model,
 revision:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),
 sourceSha256:createHash('sha256').update(readFileSync(resolve(root,'demos/euler/314_mousemoon.ra'))).digest('hex'),
 method:'Three serial fresh processes per case, rotating order; import excluded; parse/execute included; no diagnostics; process peak RSS',samples:[]};
for(let round=0;round<3;round++) for(let offset=0;offset<cases.length;offset++) {
 const [name,variant,runtime]=cases[(offset+round)%cases.length];
 if(name.startsWith('borrow') && !runtime) continue;
 const child=spawnSync(process.execPath,[resolve(root,'benchmarks/euler314-investigation.mjs'),'compiled','250',variant],
  {encoding:'utf8',timeout:90000,env:{...process.env,...(runtime?{RANK_BENCH_RUNTIME:resolve(runtime)}:{})}});
 if(child.status!==0) throw Error(child.stderr || String(child.error));
 const sample={name,round,...JSON.parse(child.stdout)};results.samples.push(sample);
 writeFileSync(output,JSON.stringify(results,null,2)+'\n'); console.log(JSON.stringify(sample));
}
