import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const records=[];const cases=[['compiled','original'],['compiled','eager'],['compiled','scalar'],['compiled','gaps'],['reference','original'],['reference','eager'],['reference','gaps']];
for(let round=0;round<3;round++)for(let k=0;k<cases.length;k++){
 const [mode,variant]=cases[(k+round)%cases.length];
 const result=spawnSync(process.execPath,['benchmarks/euler304-investigation.mjs',mode,'100000',variant],{encoding:'utf8',timeout:60000,maxBuffer:2**20});
 if(result.status!==0)throw Error(result.stderr||String(result.error));
 const row={round,...JSON.parse(result.stdout)};records.push(row);
 writeFileSync('benchmarks/baselines/2026-11-01-euler304-samples.json',JSON.stringify({node:process.version,records},null,2)+'\n');
 console.log(JSON.stringify({round,mode,variant,ms:row.ms,primeMs:row.primeMs,fibonacciMs:row.fibonacciMs,rssMiB:row.rssMiB}));
}
