import {spawnSync} from 'node:child_process';
const base=process.env.RANK433_BASE_RUNTIME;if(!base)throw Error('set RANK433_BASE_RUNTIME');
const mode=process.argv[2]??'compiled',trials=Number(process.argv[3]??3);
const current=new URL('../../packages/interpreter/out/index.js',import.meta.url).href;
const all=[['before',base,'benchmarks/experiments/euler433-original.ra'],['runtime-only',current,'benchmarks/experiments/euler433-original.ra'],['source-only',base,'benchmarks/experiments/euler433-staged-probe.ra'],['after',current,'benchmarks/experiments/euler433-staged-probe.ra']];
for(let trial=0;trial<trials;trial++){
 const variants=mode==='reference'?[all[0],all[3]]:[...all];if(trial%2)variants.reverse();
 for(const[label,runtime,file]of variants){const result=spawnSync(process.execPath,['benchmarks/experiments/euler433-run.mjs',mode,'5000000',file],{encoding:'utf8',env:{...process.env,RANK433_RUNTIME:runtime},maxBuffer:10*1024*1024});if(result.status!==0)throw Error(result.stderr);const value=JSON.parse(result.stdout);if(value.answer!=='326624372659664')throw Error('wrong answer');console.log(JSON.stringify({label,trial,...value}));}
}
