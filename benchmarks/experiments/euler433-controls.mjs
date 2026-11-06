import {spawnSync} from 'node:child_process';
const base=process.env.RANK433_BASE_RUNTIME;if(!base)throw Error('set RANK433_BASE_RUNTIME');
const current=new URL('../../packages/interpreter/out/index.js',import.meta.url).href;
const runner='benchmarks/experiments/euler433-run.mjs';
for(let trial=0;trial<3;trial++){
 const pairs=[['before',base,'benchmarks/experiments/euler433-original.ra'],['after',current,'benchmarks/experiments/euler433-staged-probe.ra']];if(trial%2)pairs.reverse();
 for(const[label,runtime,file]of pairs){const r=spawnSync(process.execPath,[runner,'reference','100000',file],{encoding:'utf8',env:{...process.env,RANK433_RUNTIME:runtime}});if(r.status)throw Error(r.stderr);const value=JSON.parse(r.stdout);if(value.answer!=='97681513944')throw Error('wrong answer');console.log(JSON.stringify({kind:'reference100k',label,trial,...value}));}
}
for(let trial=0;trial<3;trial++){
 const pairs=[['before',base],['after',current]];if(trial%2)pairs.reverse();
 for(const[label,runtime]of pairs){const r=spawnSync(process.execPath,[runner,'compiled','5000000','benchmarks/experiments/euler433-helper-probe.ra'],{encoding:'utf8',env:{...process.env,RANK433_RUNTIME:runtime}});if(r.status)throw Error(r.stderr);const value=JSON.parse(r.stdout);if(value.answer!=='326624372659664')throw Error('wrong answer');console.log(JSON.stringify({kind:'helper',label,trial,...value}));}
}
