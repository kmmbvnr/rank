import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const [output='/tmp/rank378-delivery.json'] = process.argv.slice(2);
const rows=[];
const cases=[
 ['baseline',process.env.BASELINE_RUNTIME,'benchmarks/experiments/euler378-original.ra'],
 ['compiler-only',process.env.RUNTIME,'benchmarks/experiments/euler378-original.ra'],
 ['combined',process.env.RUNTIME,'demos/euler/378_triangles.ra'],
];
for(let round=0;round<3;round++)for(const[variant,runtime,file]of cases){
 if(!runtime)throw Error('Set RUNTIME and BASELINE_RUNTIME');
 const row=JSON.parse(execFileSync(process.execPath,['benchmarks/euler378-investigation.mjs',file,'10000000','compiled'],{
  encoding:'utf8',env:{...process.env,RUNTIME:runtime,MEMORY:'1'},
 }));
 rows.push({round,variant,...row});writeFileSync(output,JSON.stringify(rows,null,2)+'\n');
}
for(let round=0;round<3;round++){
 const row=JSON.parse(execFileSync(process.execPath,['benchmarks/euler378-investigation.mjs','demos/euler/378_triangles.ra','60000000','compiled'],{
  encoding:'utf8',env:{...process.env,MEMORY:'1',DIAG:'1'},
 }));
 rows.push({round,variant:'combined-full',...row});writeFileSync(output,JSON.stringify(rows,null,2)+'\n');
}
console.log(JSON.stringify(rows));
