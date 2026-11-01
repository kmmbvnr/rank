// Run from the repository root. The baseline runtime is a preserved build of
// 4584dc82; every timed case uses a fresh process and verifies the full answer.
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import os from 'node:os';
const [baseline,output,subset='all',rounds='3',firstRound='0']=process.argv.slice(2);
if(!baseline||!output||!['all','compiled'].includes(subset))throw Error('baseline-index.js output.json [all|compiled]');
const rows=[],cases=[['before','compiled','original'],['before','compiled','production'],['after','compiled','production'],
 ...subset==='all'?[['before','reference','original'],['after','reference','production']]:[]];
for(let round=Number(firstRound);round<Number(firstRound)+Number(rounds);round++)for(let j=0;j<cases.length;j++){
 const [runtime,mode,variant]=cases[(j+round)%cases.length];
 const env={...process.env};if(runtime==='before')env.RANK_BENCH_RUNTIME=baseline;else delete env.RANK_BENCH_RUNTIME;
 const p=spawnSync(process.execPath,['benchmarks/euler310-investigation.mjs',mode,'100000',variant,'split'],{env,encoding:'utf8',timeout:60000,maxBuffer:2e6});
 if(p.status!==0)throw Error(p.stderr);
 const row={round,runtime,...JSON.parse(p.stdout)};rows.push(row);
 writeFileSync(output,JSON.stringify({node:process.version,arch:process.arch,cpu:os.cpus()[0].model,load:os.loadavg(),baseline,rows},null,2)+'\n');
 console.log(JSON.stringify({round,runtime,mode,variant,ms:row.ms,rssMiB:row.rssMiB}));
}
