import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {Interpreter} from '../../packages/interpreter/out/index.js';
// Independent small oracle: enumerate widths and ladder lengths, no Euclid parameters.
function brute(limit){
 let answer=0;
 for(let w=1;w<limit;w++){
  const hs=[];
  for(let x=w+1;x<limit;x++){
   const h=Math.sqrt(x*x-w*w);
   if(Number.isInteger(h))hs.push(h);
  }
  for(let i=1;i<hs.length;i++)for(let j=0;j<i;j++)if(hs[i]*hs[j]%(hs[i]+hs[j])===0)answer++;
 }
 return answer;
}
const limits=[1,2,3,5,50,100,119,120,199,200,201,250,500,1000];
const answers=limits.map(brute);assert.equal(answers[limits.indexOf(200)],5);assert.equal(answers.at(-1),76);
let checked=0;
for(const compilation of [false,true])for(const variant of ['original','packed','copied-groups','parity','slices','production'])for(let i=0;i<limits.length;i++){
 const s=readFileSync(new URL(variant==='production'?'../../demos/euler/309_ladders.ra':`./euler309-${variant}.ra`,import.meta.url),'utf8').replace('arg Limit integer = 1000000',`arg Limit integer = ${limits[i]}`);
 const r=new Interpreter(()=>{},{compilation});
 try{r.execute(s);assert.equal(String((r.variables.get('Answer') ?? r.lastResult)),String(answers[i]),JSON.stringify({compilation,variant,limit:limits[i]}));checked++;}finally{r.dispose();}
}
for(const compilation of [false,true]){
 const file=resolve('demos/euler/309_ladders_test.ra');
 const r=new Interpreter(()=>{},{compilation,testing:true,sourceId:file,loadModule(specifier,from){
  const id=resolve(dirname(from??file),specifier.endsWith('.ra')?specifier:specifier+'.ra');
  return {id,source:readFileSync(id,'utf8')};
 }});
 try{r.execute(readFileSync(file,'utf8'));assert.equal(r.testResults.length,6);assert(r.testResults.every(x=>x.passed),JSON.stringify(r.testResults));checked+=6;}finally{r.dispose();}
}
writeFileSync(new URL('../baselines/2026-11-01-euler309-verification.json',import.meta.url),JSON.stringify({checked,oracle:'Brute-force integer square check over each width and ladder length',limits,answers},null,2)+'\n');
console.log(`${checked} checks passed`);
