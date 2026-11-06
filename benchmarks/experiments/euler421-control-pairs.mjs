import {spawnSync} from 'node:child_process';
for(let sample=0;sample<3;sample++)for(const variant of ['native','scalar']){
 const args=variant==='native'?['benchmarks/experiments/euler421-native.mjs']:['benchmarks/experiments/euler421-run.mjs','compiled','100000000','benchmarks/experiments/euler421-scalar.ra'];
 const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:300000});if(r.status!==0)throw Error(r.stderr);
 const d=JSON.parse(r.stdout);if(d.answer!=='2304215802083466198')throw Error('wrong answer');console.log(JSON.stringify({sample,variant,...d}));
}
