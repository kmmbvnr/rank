import {spawnSync} from 'node:child_process';
for(let pair=0;pair<3;pair++)for(const variant of ['baseline','boundary']){
 const env={...process.env};if(variant==='baseline')env.RANK414_RUNTIME=process.env.RANK414_BASELINE??'/tmp/rank414-baseline/packages/interpreter/out/index.js';
 const r=spawnSync(process.execPath,['benchmarks/experiments/euler414-run.mjs','compiled','2','300',variant==='boundary'&&process.env.RANK414_DELIVERED?'delivered':'original'],{env,encoding:'utf8'});
 if(r.status!==0)throw Error(r.stderr);console.log(JSON.stringify({pair,variant,...JSON.parse(r.stdout)}));
}
