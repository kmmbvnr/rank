import {spawnSync} from 'node:child_process';
const m=process.argv[2]??'1000000',variants=process.argv.slice(3);
for(let sample=0;sample<3;sample++)for(const variant of variants.length?variants:['original','builtin','scalar','ranked']){
 const r=spawnSync(process.execPath,['benchmarks/experiments/euler421-run.mjs','compiled',m,`benchmarks/experiments/euler421-${variant}.ra`],{encoding:'utf8',timeout:300000});
 if(r.status!==0)throw Error(`${variant}: ${r.error??r.stderr}`);
 const d=JSON.parse(r.stdout),expected=m==='1000000'?'31388381276205144':m==='100000000'?'2304215802083466198':undefined;
 if(expected&&d.answer!==expected)throw Error('wrong answer');console.log(JSON.stringify({variant,sample,...d}));
}
