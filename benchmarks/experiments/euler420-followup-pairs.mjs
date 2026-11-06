import {spawnSync} from 'node:child_process';
if(!process.env.RANK420_BASELINE)throw Error('Set RANK420_BASELINE to the frozen baseline runtime URL');
const variants = [
 ['original', 'benchmarks/experiments/euler420-original.ra', process.env.RANK420_BASELINE],
 ['final', 'demos/euler/420_squarematrices.ra'],
 ['helper', 'benchmarks/experiments/euler420-helper.ra'],
];
for(let sample=0;sample<3;sample++)for(const [variant,file,runtime]of variants){
 const env={...process.env};if(runtime)env.RANK420_RUNTIME=runtime;else delete env.RANK420_RUNTIME;
 const r=spawnSync(process.execPath,['benchmarks/experiments/euler420-run.mjs','compiled','10000000',file],{encoding:'utf8',env});
 if(r.status!==0)throw Error(r.stderr);
 const d=JSON.parse(r.stdout);if(d.answer!=='145159332')throw Error('wrong answer');
 console.log(JSON.stringify({variant,sample,...d}));
}
