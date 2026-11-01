import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync,mkdirSync,writeFileSync} from 'node:fs';
import ts from 'typescript';
const revision='b6bdadafdb408b1b8d033088112c6bc555e3318d';
const baseline='/tmp/rank308/before';mkdirSync(baseline,{recursive:true});
cpSync('packages/interpreter/out',baseline,{recursive:true});
const old=spawnSync('git',['show',`${revision}:packages/interpreter/src/runtime/owned-array.ts`],{encoding:'utf8'});
assert.equal(old.status,0,old.stderr);
writeFileSync(`${baseline}/runtime/owned-array.js`,ts.transpileModule(old.stdout,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
// Preserve Node's package lookup for external runtime dependencies.
try { const {symlinkSync}=await import('node:fs');symlinkSync(process.cwd()+'/node_modules','/tmp/rank308/node_modules','dir'); } catch(e) {if(e.code!=='EEXIST')throw e;}
const cases=[['compiled','original','before'],['compiled','original','after'],['compiled','native','after'],['reference','original','before'],['reference','original','after'],['reference','native','after']];
const results=[];
for(let sample=0;sample<3;sample++)for(let i=0;i<cases.length;i++){
 const [mode,variant,version]=cases[(i+sample)%cases.length];
 const env={...process.env};if(version==='before')env.RANK_BENCH_RUNTIME=`${baseline}/index.js`;else delete env.RANK_BENCH_RUNTIME;
 const r=spawnSync(process.execPath,['benchmarks/euler308-investigation.mjs',mode,'10001',variant],{env,encoding:'utf8',timeout:60000});
 assert.equal(r.status,0,r.error?.message??r.stderr);
 const row={sample,version,...JSON.parse(r.stdout)};results.push(row);
 process.stderr.write(JSON.stringify({sample,version,mode,variant,ms:row.ms,cpuMs:row.cpuMs,rssMiB:row.rssMiB,cow:row.diagnostics.cowCopiedCells})+'\n');
}
writeFileSync('benchmarks/baselines/2026-11-01-euler308-runtime.json',JSON.stringify({node:process.version,baselineRevision:revision,baseline:'Baseline owned-array.ts; all other modules identical',description:'Serial fresh processes, rotating order; parse+execution; 60s process watchdog',results},null,2)+'\n');
