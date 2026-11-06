import {spawnSync} from 'node:child_process';
for(let sample=0;sample<3;sample++)for(const variant of ['original','row-bounds']){
 const r=spawnSync(process.execPath,['benchmarks/experiments/euler420-run.mjs','compiled','10000000',`benchmarks/experiments/euler420-${variant}.ra`],{encoding:'utf8'});
 if(r.status!==0)throw Error(r.stderr);
 const d=JSON.parse(r.stdout);if(d.answer!=='145159332')throw Error('wrong answer');
 console.log(JSON.stringify({variant,sample,...d}));
}
