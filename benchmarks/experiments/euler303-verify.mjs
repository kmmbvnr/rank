import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {Interpreter} from '../../packages/interpreter/out/index.js';
// Enumerate actual allowed integers in numerical order, independently of the
// remainder graph. Resolve each small divisor on its first divisible integer.
const pending=new Set(Array.from({length:200},(_,i)=>i+1)),answers=new Map();let level=[1n,2n],tested=0;
for(let length=1;length<=12&&pending.size;length++){
 for(const value of level){tested++;for(const n of pending)if(value%BigInt(n)===0n){answers.set(n,value);pending.delete(n);}if(!pending.size)break;}
 if(pending.size)level=level.flatMap(value=>[value*10n,value*10n+1n,value*10n+2n]);
}
assert.equal(pending.size,0);let checks=0;const results=[];
for(const mode of ['compiled','reference'])for(const variant of ['original','early','array','arrayearly','production']){
 const source=readFileSync(new URL(variant==='production'?'../../demos/euler/303_smalldigits.ra':`./euler303-${variant}.ra`,import.meta.url),'utf8');const r=new Interpreter(()=>{},{compilation:mode==='compiled'});
 try{r.execute(source.replace('arg Limit integer = 10000','arg Limit integer = 0'));const fn=r.variables.get('smallest');assert.equal(fn?.kind,'function');
 for(const [n,value] of answers){assert.equal(fn.call([BigInt(n)]),value);checks++;}
 assert.equal(fn.call([9999n]),11112222222222222222n);checks++;
 }finally{r.dispose();}
 results.push({mode,variant,smallDivisors:200,wideCase:9999});
}
for(const mode of ['compiled','reference'])for(const variant of ['original','early','array','arrayearly','reduce','production']){
 const source=readFileSync(new URL(variant==='production'?'../../demos/euler/303_smalldigits.ra':`./euler303-${variant}.ra`,import.meta.url),'utf8'),r=new Interpreter(()=>{},{compilation:mode==='compiled'});
 try{r.execute(source.replace('arg Limit integer = 10000','arg Limit integer = 100'));assert.equal(r.variables.get('Answer'),11363107n);checks++;}finally{r.dispose();}
}
const report={checks,enumeratedCandidates:tested,maxIndependentValue:String([...answers.values()].reduce((a,b)=>a>b?a:b)),results};
writeFileSync(new URL('../baselines/2026-10-31-euler303-verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
