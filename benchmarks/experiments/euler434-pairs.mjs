import {spawnSync} from 'node:child_process';
const base=process.env.RANK434_BASE_RUNTIME;if(!base)throw Error('set RANK434_BASE_RUNTIME');
const current=new URL('../../packages/interpreter/out/index.js',import.meta.url).href;
const mode=process.argv[2]??'compiled';
const variants=[['before',base,'benchmarks/experiments/euler434-original.ra'],['runtime-only',current,'benchmarks/experiments/euler434-original.ra'],['source-only',base,'demos/euler/434_rigidgrid.ra'],['after',current,'demos/euler/434_rigidgrid.ra']];
for(let trial=0;trial<3;trial++){
 const order=trial%2?[...variants].reverse():variants;
 for(const[label,runtime,file]of order){const r=spawnSync(process.execPath,['benchmarks/experiments/euler434-run.mjs',mode,'100',file],{encoding:'utf8',env:{...process.env,RANK434_RUNTIME:runtime},maxBuffer:10*1024*1024});if(r.status!==0)throw Error(r.stderr);const value=JSON.parse(r.stdout);if(value.answer!=='863253606')throw Error('wrong answer');console.log(JSON.stringify({trial,label,...value}));}
}
