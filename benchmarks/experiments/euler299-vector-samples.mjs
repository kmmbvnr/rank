import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';

// Build an isolated baseline checkout first; never swap the working runtime
// between measurements. Each sample imports just one interpreter version.
const baseline=process.argv[2];
assert(baseline, 'Pass the absolute baseline interpreter/out/index.js path');
const cases=[
 ['baseline','compiled','vector'],
 ['current','compiled','vector'],
 ['current','compiled','symmetry'],
 ['current','reference','vector'],
 ['baseline','compiled','original'],
];
const samples=[];
for(let repeat=0;repeat<3;repeat++)for(let i=0;i<cases.length;i++){
 const [version,mode,variant]=cases[(i+repeat)%cases.length];
 const env={...process.env};
 delete env.RANK_BENCH_RUNTIME;
 if(version==='baseline')env.RANK_BENCH_RUNTIME=baseline;
 const p=spawnSync(process.execPath,['benchmarks/euler299-investigation.mjs',mode,variant],{env,encoding:'utf8',timeout:45000});
 assert.equal(p.status,0,p.stderr||p.error?.message);
 const row={repeat,version,...JSON.parse(p.stdout)};
 samples.push(row);console.log(JSON.stringify(row));
 writeFileSync('benchmarks/baselines/2026-10-31-euler299-vector-compiler.json',JSON.stringify({baseline:'40adaba7',node:process.version,platform:process.platform,arch:process.arch,samples},null,2)+'\n');
}
