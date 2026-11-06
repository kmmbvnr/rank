import {spawnSync} from 'node:child_process';
const baseline=process.env.RANK417_BASELINE??'/tmp/rank417-delivery-baseline/packages/interpreter/out/index.js';
for(let sample=0;sample<3;sample++)for(const variant of ['before','after']){
 const env={...process.env};delete env.PHASES;
 if(variant==='before')env.RANK417_RUNTIME=baseline;else delete env.RANK417_RUNTIME;
 const file=variant==='before'?'benchmarks/experiments/euler417-original.ra':'demos/euler/417_reciprocalcycles.ra';
 const r=spawnSync(process.execPath,['benchmarks/experiments/euler417-run.mjs','compiled','100000000',file],{env,encoding:'utf8'});
 if(r.status!==0)throw Error(r.stderr);
 const d=JSON.parse(r.stdout);if(d.answer!=='446572970925740')throw Error('wrong full answer');
 console.log(JSON.stringify({variant,sample,...d}));
}
