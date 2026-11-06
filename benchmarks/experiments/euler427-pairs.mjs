import {spawnSync} from 'node:child_process';
for(let sample=0;sample<3;sample++)for(const [variant,file] of [
 ['before','benchmarks/experiments/euler427-original.ra'],
 ['grouped','benchmarks/experiments/euler427-grouped.ra'],
 ['rolling','benchmarks/experiments/euler427-rolling.ra'],
]) {
 const child=spawnSync(process.execPath,['benchmarks/experiments/euler427-run.mjs','compiled','7500000',file],{encoding:'utf8'});
 if(child.status!==0)throw Error(child.stderr);
 const value=JSON.parse(child.stdout);
 if(value.answer!=='97138867')throw Error('wrong full answer');
 console.log(JSON.stringify({sample,variant,...value}));
}
