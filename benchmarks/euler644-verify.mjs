import {execFileSync} from 'node:child_process';
import {solve} from './euler644-oracle.mjs';
const results=[];
for(const [lo,hi] of [[2,3],[2,10],[10,20],[5,25],[20,40],[40,70],[20,100]]){
 const oracle=solve(lo,hi);
 for(const variant of ['original','scan-min','adaptive'])for(const mode of ['compiled','reference']){
  const r=JSON.parse(execFileSync(process.execPath,['benchmarks/euler644-investigation.mjs',String(lo),String(hi),mode,variant],{encoding:'utf8',timeout:30000,env:{...process.env,PROFILE:'',PROGRESS:''}}));
  if(r.answer!==oracle.answer)throw Error(JSON.stringify({r,oracle}));
  results.push(r);
 }
}
console.log(JSON.stringify({checks:results.length,results}));
