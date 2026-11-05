import {spawnSync} from 'node:child_process';
const baseline=process.env.RANK415_BASELINE??'/tmp/rank415-delivery-baseline/packages/interpreter/out/index.js';
for(const [variant,count,file,limit] of [['before',1,'original','10000000'],['after',3,'demos/euler/415_titanicsets.ra','5000000']])for(let sample=0;sample<count;sample++){
 const env={...process.env};delete env.RANK415_PHASES;
 if(variant==='before')env.RANK415_RUNTIME=baseline;else delete env.RANK415_RUNTIME;
 const result=spawnSync(process.execPath,['benchmarks/experiments/euler415-run.mjs','compiled','100000000000',limit,file],{env,encoding:'utf8'});
 if(result.status!==0)throw Error(result.stderr);
 const observation=JSON.parse(result.stdout);
 if(observation.answer!=='55859742')throw Error('wrong full answer');
 console.log(JSON.stringify({variant,sample,...observation}));
}
