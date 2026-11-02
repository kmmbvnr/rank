import {execFileSync} from 'node:child_process';
for(let sample=0;sample<3;sample++)for(const mode of ['compiled','reference'])for(const variant of sample%2?['adaptive','scan-min','original']:['original','scan-min','adaptive']){
 const r=JSON.parse(execFileSync(process.execPath,['benchmarks/euler644-investigation.mjs','20','100',mode,variant],{encoding:'utf8',timeout:30000,env:{...process.env,PROFILE:'',PROGRESS:''}}));
 if(r.answer!=='18.71276493')throw Error('wrong answer');
 console.log(JSON.stringify({sample,...r}));
}
