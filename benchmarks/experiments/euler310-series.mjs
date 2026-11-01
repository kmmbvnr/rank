// Run from the repository root; cases execute serially in fresh processes.
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import os from 'node:os';
const [output,subset='all']=process.argv.slice(2);
if(!output||!['all','compiled'].includes(subset))throw Error('output.json [all|compiled]');
const rows=[],cases=subset==='compiled'?[['compiled','original'],['compiled','scalar'],['compiled','histogram']]:[
 ['compiled','original'],['compiled','scalar'],['compiled','histogram'],['compiled','inline-histogram'],
 ['reference','original'],['reference','histogram-array']];
for(let round=0;round<3;round++)for(let j=0;j<cases.length;j++){
 const [mode,variant]=cases[(j+round)%cases.length];
 const p=spawnSync(process.execPath,['benchmarks/euler310-investigation.mjs',mode,'100000',variant,'split'],{encoding:'utf8',timeout:60000,maxBuffer:2e6});
 if(p.status!==0)throw Error(p.stderr);
 const row={round,...JSON.parse(p.stdout)};rows.push(row);
 writeFileSync(output,JSON.stringify({node:process.version,arch:process.arch,cpu:os.cpus()[0].model,load:os.loadavg(),rows},null,2)+'\n');
 console.log(JSON.stringify({round,mode,variant,ms:row.ms,rssMiB:row.rssMiB}));
}
