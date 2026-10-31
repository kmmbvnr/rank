import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const samples=[];
const exact=process.argv[2]==='exact';
const cases=exact?[['compiled','exact','cow'],['reference','exact','none']]:[['compiled','original','cow'],['compiled','skip','cow'],['reference','original','none'],['reference','skip','none']];
for(let repeat=0;repeat<3;repeat++)for(const [mode,variant,policy] of cases){
 const args=[...(policy==='none'?[]:['--import',`./benchmarks/experiments/euler298-alias-${policy}.mjs`]),'benchmarks/euler298-investigation.mjs',mode,variant,'50'];
 const p=spawnSync(process.execPath,args,{encoding:'utf8',timeout:45000});assert.equal(p.status,0,p.stderr);
 const sample={repeat,policy,...JSON.parse(p.stdout)};assert.equal(sample.correct,true,JSON.stringify(sample));samples.push(sample);console.log(JSON.stringify(sample));
 writeFileSync(`benchmarks/baselines/2026-10-31-euler298-${exact?'exact-samples':'samples'}.json`,JSON.stringify({node:process.version,platform:process.platform,architecture:process.arch,samples},null,2)+'\n');
}
