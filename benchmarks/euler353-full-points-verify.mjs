import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spherePoints} from './lib/euler353-oracle.mjs';
const{Interpreter,isRankArray}=await import(process.env.RANK353_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const expected=new Map(),rows=[];
for(let n=1;n<=15;n++){
 const r=2**n-1,b=r+1;
 expected.set(r,spherePoints(r,true).map(([x,y,z])=>BigInt((z+r)*b*b+x*b+y)).sort((a,b)=>a<b?-1:a>b?1:0));
}
const src=readFileSync(process.env.RANK353_SOURCE || new URL('../demos/euler/353_riskymoon.ra',import.meta.url),'utf8').split('\nSum =')[0];
for(const compilation of [false,true]){
 const runtime=new Interpreter(()=>{},{compilation});
 try{runtime.execute(src);for(const[r,want]of expected){const t=performance.now(),actual=runtime.execute(`${r} moonpoints`);assert.ok(isRankArray(actual));assert.deepEqual(actual.items,want,`${compilation} ${r}`);rows.push({compilation,r,count:want.length,ms:performance.now()-t});}}
 finally{runtime.dispose()}
}
const result={checks:rows.length,rows,oracle:'independent coordinate scan at every full default radius'};
if(process.env.RANK353_VERIFY_OUTPUT)writeFileSync(process.env.RANK353_VERIFY_OUTPUT,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({checks:rows.length,largest:rows.filter(x=>x.r===32767)}));
