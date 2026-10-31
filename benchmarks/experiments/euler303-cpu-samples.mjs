// A second matched series records CPU as well as wall time after substantial
// external scheduling noise was observed. Preserve the earlier samples too.
import {spawnSync} from 'node:child_process';import {writeFileSync} from 'node:fs';const samples=[];
const cases=[['before','original'],['before','production'],['final','production']];
for(let round=0;round<3;round++)for(const [version,variant] of cases.slice(round).concat(cases.slice(0,round))){
 const p=spawnSync(process.execPath,[new URL('../euler303-investigation.mjs',import.meta.url).pathname,'compiled','10000',variant],{encoding:'utf8',timeout:60000,env:{...process.env,...(version==='before'?{RANK_BENCH_RUNTIME:'/tmp/rank303-before/out/index.js'}:{})}});
 if(p.status!==0)throw Error(p.stderr||String(p.error));const x={round,version,...JSON.parse(p.stdout)};samples.push(x);console.log(JSON.stringify(x));writeFileSync(new URL('../baselines/2026-10-31-euler303-cpu-samples.json',import.meta.url),JSON.stringify(samples,null,2)+'\n');
}
