import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const records=[];
for(let round=0;round<3;round++)for(const [script,args] of [
 ['benchmarks/euler304-investigation.mjs',['compiled','100000','prefix']],
 ['benchmarks/euler304-investigation.mjs',['compiled','100000','prefixeager']],
 ['benchmarks/experiments/euler304-primes.mjs',['native']],
 ['benchmarks/experiments/euler304-primes.mjs',['screen','100000','65536','1048576']],
 ['benchmarks/experiments/euler304-primes.mjs',['screen','100000','10000000','1048576']],
]){
 const p=spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:60000});if(p.status!==0)throw Error(p.stderr||String(p.error));
 const row={round,...JSON.parse(p.stdout)};records.push(row);writeFileSync('benchmarks/baselines/2026-11-01-euler304-extra.json',JSON.stringify({node:process.version,records},null,2)+'\n');console.log(JSON.stringify({round,...(row.variant?{variant:row.variant}:{kind:row.kind,cap:row.cap}),ms:row.ms,fibonacciMs:row.fibonacciMs,rssMiB:row.rssMiB}));
}
