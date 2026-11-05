import {spawnSync} from 'node:child_process';
const count=Number(process.env.RANK414_FRAME_PAIRS??3);
const baseline=process.env.RANK414_FRAME_BASELINE??'/tmp/rank414-frames-baseline/packages/interpreter/out/index.js';
for(let pair=0;pair<count;pair++)for(const variant of ['baseline','inline']){
 const env={...process.env};
 if(variant==='baseline')env.RANK414_RUNTIME=baseline;else delete env.RANK414_RUNTIME;
 const result=spawnSync(process.execPath,['benchmarks/experiments/euler414-run.mjs','compiled','2','300','delivered'],{env,encoding:'utf8'});
 if(result.status!==0)throw Error(result.stderr);
 const observation=JSON.parse(result.stdout);
 if(observation.answer!=='552506775824935461')throw Error('incorrect Euler 414 answer');
 console.log(JSON.stringify({pair,variant,...observation}));
}
