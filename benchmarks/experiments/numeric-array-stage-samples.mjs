import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';

const baseline=process.argv[2];
const rounds=process.argv[3]??'12';
assert(['12','120'].includes(rounds));
assert(baseline,'Pass baseline interpreter/out/index.js');
const cases=['integer-matrix','real-matrix','real-broadcast'].flatMap(variant=>
 ['baseline','current'].map(version=>({variant,version})));
const samples=[];
for(let repeat=0;repeat<5;repeat++)for(let i=0;i<cases.length;i++){
 const {variant,version}=cases[(i+repeat)%cases.length];
 const env={...process.env};delete env.RANK_BENCH_RUNTIME;
 if(version==='baseline')env.RANK_BENCH_RUNTIME=baseline;
 const p=spawnSync(process.execPath,['benchmarks/experiments/numeric-array-stages.mjs',variant,'compiled',rounds],{env,encoding:'utf8',timeout:45000});
 assert.equal(p.status,0,p.stderr||p.error?.message);
 const row={repeat,version,...JSON.parse(p.stdout)};samples.push(row);console.log(JSON.stringify(row));
 writeFileSync(`benchmarks/baselines/2026-10-31-numeric-array-stages${rounds==='12'?'':'-120'}.json`,JSON.stringify({baseline:'40adaba7',node:process.version,platform:process.platform,arch:process.arch,samples},null,2)+'\n');
}
