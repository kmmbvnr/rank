import {spawnSync} from 'node:child_process';
const base=process.env.RANK434_BASE_CONVOLUTION;if(!base)throw Error('set RANK434_BASE_CONVOLUTION');
const current=new URL('../../packages/interpreter/out/convolution.js',import.meta.url).href;
for(const[size,rounds]of [[101,10000],[513,500],[5000,10]])for(let trial=0;trial<3;trial++){
 const pairs=[['before',base],['after',current]];if(trial%2)pairs.reverse();
 for(const[label,module]of pairs){const r=spawnSync(process.execPath,['benchmarks/experiments/euler434-convolution.mjs',String(size),String(rounds)],{encoding:'utf8',env:{...process.env,RANK434_CONVOLUTION:module}});if(r.status!==0)throw Error(r.stderr);console.log(JSON.stringify({label,trial,...JSON.parse(r.stdout)}));}
}
