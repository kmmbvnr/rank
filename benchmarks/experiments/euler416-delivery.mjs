import {spawnSync} from 'node:child_process';
const baseline=process.env.RANK416_BASELINE??'/tmp/rank416-delivery-baseline/packages/interpreter/out/index.js';
for(let sample=0;sample<3;sample++)for(const variant of ['before','after']){
 const env={...process.env};delete env.PHASES;
 if(variant==='before')env.RANK416_RUNTIME=baseline;else delete env.RANK416_RUNTIME;
 const file=variant==='before'?'benchmarks/experiments/euler416-original.ra':'demos/euler/416_froggy.ra';
 const result=spawnSync(process.execPath,['benchmarks/experiments/euler416-run.mjs','compiled','10','1000000000000',file],{env,encoding:'utf8'});
 if(result.status!==0)throw Error(result.stderr);
 const observation=JSON.parse(result.stdout);if(observation.answer!=='898082747')throw Error('wrong full answer');
 console.log(JSON.stringify({variant,sample,...observation}));
}
