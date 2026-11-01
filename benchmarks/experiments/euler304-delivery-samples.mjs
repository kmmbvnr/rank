import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const rows=[],baseline='/tmp/rank304-before/out/index.js';
const cases=[['before','compiled','original',baseline],['source','compiled','production',baseline],['runtime','compiled','original',undefined],['after','compiled','production',undefined],['before','reference','original',baseline],['after','reference','production',undefined]];
for(let round=0;round<3;round++)for(let k=0;k<cases.length;k++){
 const [phase,mode,variant,runtime]=cases[(round+k)%cases.length];
 const env={...process.env};if(runtime)env.RANK_BENCH_RUNTIME=runtime;else delete env.RANK_BENCH_RUNTIME;
 const p=spawnSync(process.execPath,['benchmarks/euler304-investigation.mjs',mode,'100000',variant],{encoding:'utf8',timeout:60000,env});if(p.status!==0)throw Error(p.stderr||String(p.error));
 const row={round,phase,...JSON.parse(p.stdout)};rows.push(row);
 writeFileSync('benchmarks/baselines/2026-11-01-euler304-delivery.json',JSON.stringify({node:process.version,baseline:'51362d77 (prime sources unchanged since 7e04577a)',records:rows},null,2)+'\n');console.log(JSON.stringify({round,phase,mode,ms:row.ms,cpuMs:row.cpuMs,rssMiB:row.rssMiB}));
}
