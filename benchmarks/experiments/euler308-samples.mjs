import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const cases=[['compiled','original'],['compiled','inline'],['compiled','native'],['reference','original'],['reference','native']];
const results=[];
for(let sample=0;sample<3;sample++)for(let i=0;i<cases.length;i++){
 const [mode,variant]=cases[(i+sample)%cases.length];
 const r=spawnSync(process.execPath,['benchmarks/euler308-investigation.mjs',mode,'10001',variant],{encoding:'utf8',timeout:60000});
 assert.equal(r.status,0,r.error?.message??r.stderr);
 const row={sample,...JSON.parse(r.stdout)};results.push(row);
 process.stderr.write(JSON.stringify({sample,mode,variant,ms:row.ms,cpuMs:row.cpuMs,rssMiB:row.rssMiB})+'\n');
}
writeFileSync('benchmarks/baselines/2026-11-01-euler308-samples.json',JSON.stringify({node:process.version,description:'Serial fresh processes, rotated case order; imports/startup excluded, parse + execution included',results},null,2)+'\n');
