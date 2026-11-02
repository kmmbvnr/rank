import {execFileSync} from 'node:child_process';
for(let sample=0;sample<3;sample++)for(const mode of ['compiled','reference']){
 for(const [variant,control] of sample%2?[['final',''],['final','baseline'],['original',''],['original','baseline']]:[['original','baseline'],['original',''],['final','baseline'],['final','']]){
  const r=JSON.parse(execFileSync(process.execPath,['benchmarks/euler644-investigation.mjs','20','100',mode,variant],{encoding:'utf8',timeout:30000,env:{...process.env,PROFILE:'',PROGRESS:'',CONTROL:control}}));
  console.log(JSON.stringify({sample,...r}));
 }
}
