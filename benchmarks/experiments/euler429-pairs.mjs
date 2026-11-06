import {spawnSync} from 'node:child_process';
for(const mode of ['compiled','reference'])for(let sample=0;sample<3;sample++)for(const variant of (sample%2?['after','before']:['before','after'])) {
 const file=variant==='before'?'benchmarks/experiments/euler429-original.ra':'demos/euler/429_unitary.ra';
 const child=spawnSync(process.execPath,['benchmarks/experiments/euler429-run.mjs',mode,'100000000',file],{encoding:'utf8'});
 if(child.status!==0)throw Error(child.stderr);
 const data=JSON.parse(child.stdout);
 if(data.answer!=='98792821')throw Error('wrong full answer');
 console.log(JSON.stringify({sample,variant,...data}));
}
