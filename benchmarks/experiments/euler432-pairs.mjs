import{spawnSync}from'node:child_process';
const baseline=process.env.RANK432_BASE_RUNTIME;
if(!baseline)throw Error('set RANK432_BASE_RUNTIME to the baseline interpreter URL');
const mode=process.argv[2]??'compiled';
const variants=[['before',baseline,'benchmarks/experiments/euler432-original.ra'],['compiler-only',undefined,'benchmarks/experiments/euler432-original.ra'],['source-only',baseline,'demos/euler/432_totientsum.ra'],['after',undefined,'demos/euler/432_totientsum.ra']];
for(let sample=0;sample<3;sample++)for(const[variant,runtime,file]of(sample%2?[...variants].reverse():variants)) {
 if(mode==='reference'&&!['before','after'].includes(variant))continue;
 const child=spawnSync(process.execPath,['benchmarks/experiments/euler432-run.mjs',mode,'100000000000','10000000',file],{encoding:'utf8',env:{...process.env,RANK432_RUNTIME:runtime??new URL('../../packages/interpreter/out/index.js',import.meta.url).href}});
 if(child.status!==0)throw Error(child.stderr);
 const data=JSON.parse(child.stdout);if(data.answer!=='754862080')throw Error('wrong full answer');
 console.log(JSON.stringify({sample,variant,...data}));
}
