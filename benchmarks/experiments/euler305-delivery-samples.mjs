import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const rows=[],before='/tmp/rank305-before/out/index.js';
const cases=[['before','compiled','original',before],['source','compiled','production',before],['runtime','compiled','original',undefined],['after','compiled','production',undefined],['before','reference','original',before],['after','reference','production',undefined]];
for(let round=0;round<3;round++)for(let k=0;k<cases.length;k++){
 const [phase,mode,variant,runtime]=cases[(k+round)%cases.length],env={...process.env};if(runtime)env.RANK_BENCH_RUNTIME=runtime;else env.RANK_BENCH_RUNTIME='/tmp/rank305-after/out/index.js';
 const p=spawnSync(process.execPath,['benchmarks/euler305-investigation.mjs',mode,'13',variant],{encoding:'utf8',timeout:60000,env,maxBuffer:2**20});if(p.status!==0)throw Error(p.stderr||String(p.error));
 const row={round,phase,...JSON.parse(p.stdout)};rows.push(row);writeFileSync('benchmarks/baselines/2026-11-01-euler305-delivery.json',JSON.stringify({node:process.version,baseline:'2a43b3bd; only record-signature preparation differs',records:rows},null,2)+'\n');console.log(JSON.stringify({round,phase,mode,ms:row.ms,cpuMs:row.cpuMs,rssMiB:row.rssMiB}));
}
