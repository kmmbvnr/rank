import {spawnSync} from 'node:child_process';
for(let sample=0;sample<3;sample++)for(const variant of ['original','prime-reverse']){
 const result=spawnSync(process.execPath,['benchmarks/experiments/euler417-run.mjs','compiled','100000000',`benchmarks/experiments/euler417-${variant}.ra`],{encoding:'utf8'});
 if(result.status!==0)throw Error(result.stderr);
 const observation=JSON.parse(result.stdout);if(observation.answer!=='446572970925740')throw Error('wrong answer');
 console.log(JSON.stringify({variant,sample,...observation}));
}
