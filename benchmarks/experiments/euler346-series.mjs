import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const samples=[];
for(let trial=0;trial<3;trial++) {
  let files=['original','split','generator','all-generator'];
  if(trial%2)files.reverse();
  for(const name of files)for(const mode of ['compiled','reference']){
    const file=`benchmarks/experiments/euler346-${name}.ra`;
    const r=spawnSync(process.execPath,['benchmarks/euler346-investigation.mjs',file,mode],{encoding:'utf8',env:process.env});
    if(r.status!==0)throw Error(r.stderr||r.stdout);
    const sample={trial,...JSON.parse(r.stdout)};samples.push(sample);
  }
}
writeFileSync(process.argv[2],JSON.stringify(samples,null,2)+'\n');
for(const file of [...new Set(samples.map(x=>x.file))])for(const mode of ['compiled','reference']) {
 const group=samples.filter(x=>x.file===file&&x.mode===mode);
 const median=k=>group.map(x=>x[k]).sort((a,b)=>a-b)[1];
 console.log(JSON.stringify({file,mode,ms:median('ms'),rssMiB:median('rssMiB')}));
}
