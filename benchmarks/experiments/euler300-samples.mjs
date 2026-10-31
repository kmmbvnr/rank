import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const results=[];
const cases=[['compiled','original'],['compiled','nocopy'],['compiled','maximal-scalar'],['reference','original'],['reference','maximal']];
for(let round=0;round<3;round++)for(let j=0;j<cases.length;j++){
 const [mode,variant]=cases[(j+round)%cases.length];
 const child=spawnSync(process.execPath,['benchmarks/euler300-investigation.mjs',mode,variant,'15'],{encoding:'utf8',timeout:60000});
 if(child.status!==0)throw Error(`${mode}/${variant}: ${child.error??child.stderr}`);
 const result={round,...JSON.parse(child.stdout)};results.push(result);
 writeFileSync('benchmarks/baselines/2026-10-31-euler300-samples.json',JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,results},null,2)+'\n');
 console.log(JSON.stringify({round,mode,variant,seconds:result.ms/1000,rssMiB:result.rssMiB}));
}
