import {spawnSync} from 'node:child_process';
for(let sample=0;sample<3;sample++)for(const variant of sample%2?['grouped','lines']:['lines','grouped']) {
 const run=spawnSync(process.execPath,['benchmarks/euler514-investigation.mjs','100','compiled',variant],{encoding:'utf8',timeout:240000});
 if(run.error||run.status!==0)throw Error(run.error?.message||run.stderr);
 console.log(JSON.stringify({sample,...JSON.parse(run.stdout)}));
}
