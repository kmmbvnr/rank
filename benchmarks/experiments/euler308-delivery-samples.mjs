import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const cases=[['compiled','original','before'],['compiled','production','after'],['reference','original','before'],['reference','production','after']];
const results=[];
for(let sample=0;sample<3;sample++)for(let i=0;i<cases.length;i++){
 const [mode,variant,version]=cases[(i+sample)%cases.length];
 const env={...process.env};
 if(version==='before')env.RANK_BENCH_RUNTIME='/tmp/rank308/before/index.js';else delete env.RANK_BENCH_RUNTIME;
 const r=spawnSync(process.execPath,['benchmarks/euler308-investigation.mjs',mode,'10001',variant],{env,encoding:'utf8',timeout:60000});
 assert.equal(r.status,0,r.error?.message??r.stderr);
 const row={sample,version,...JSON.parse(r.stdout)};results.push(row);
 process.stderr.write(JSON.stringify({sample,version,mode,variant,ms:row.ms,cpuMs:row.cpuMs,rssMiB:row.rssMiB})+'\n');
}
writeFileSync('benchmarks/baselines/2026-11-01-euler308-delivery.json',JSON.stringify({node:process.version,baselineRevision:'b6bdadafdb408b1b8d033088112c6bc555e3318d',description:'Baseline snapshot created by euler308-runtime-samples.mjs; serial fresh processes, rotating order; parse+execution; 60s process watchdog',results},null,2)+'\n');
