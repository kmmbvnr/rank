import {spawnSync} from 'node:child_process';
const full=process.argv.includes('--full');
for(let sample=0;sample<3;sample++)for(const mode of full?['compiled']:['compiled','reference'])for(const variant of full?['final']:['original','final']){
 const env={...process.env};if(variant==='original'){if(!env.RANK421_BASELINE)throw Error('Set RANK421_BASELINE to the frozen runtime URL');env.RANK421_RUNTIME=env.RANK421_BASELINE;}else delete env.RANK421_RUNTIME;
 const file=variant==='original'?'benchmarks/experiments/euler421-original.ra':'demos/euler/421_primefactors.ra';
 const r=spawnSync(process.execPath,['benchmarks/experiments/euler421-run.mjs',mode,full?'100000000':'1000000',file],{encoding:'utf8',timeout:300000,env});
 if(r.status!==0)throw Error(r.stderr);const d=JSON.parse(r.stdout);
 if(d.answer!==(full?'2304215802083466198':'31388381276205144'))throw Error('wrong answer');console.log(JSON.stringify({sample,variant,...d}));
}
