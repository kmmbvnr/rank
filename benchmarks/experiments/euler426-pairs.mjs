import { spawnSync } from 'node:child_process';
for (let sample=0;sample<3;sample++) for(const [variant,file] of [
 ['before','benchmarks/experiments/euler426-original.ra'],
 ['after','demos/euler/426_boxball.ra'],
]) {
 const child=spawnSync(process.execPath,['benchmarks/experiments/euler426-run.mjs','compiled','10000000',file],{encoding:'utf8'});
 if(child.status!==0)throw Error(child.stderr);
 const value=JSON.parse(child.stdout);
 if(value.answer!=='31591886008')throw Error('wrong full answer');
 console.log(JSON.stringify({sample,variant,...value}));
}
