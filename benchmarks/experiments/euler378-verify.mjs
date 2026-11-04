import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const divisors=n=>{let count=0;for(let d=1;d*d<=n;d++)if(n%d===0)count+=d*d===n?1:2;return count;};
const brute=n=>{
 const values=Array.from({length:n},(_,i)=>divisors((i+1)*(i+2)/2));
 let answer=0n;
 for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(values[i]>values[j])for(let k=j+1;k<n;k++)if(values[j]>values[k])answer++;
 return String(answer);
};
const rows=[];
for(const limit of [0,1,2,3,10,20,30,100]){
 const expected=brute(limit);
 for(const variant of ['original','paired','one-tree','bounded-tree','number-one-tree','number-bounded-tree','delivery'])for(const mode of ['compiled','reference']){
  if(variant.startsWith('number-')&&mode==='reference')continue;
  const numeric=variant.startsWith('number-');
  const script=numeric?'benchmarks/experiments/euler378-number-fenwick.mjs':'benchmarks/euler378-investigation.mjs';
  const file=variant==='delivery'?'demos/euler/378_triangles.ra':`benchmarks/experiments/euler378-${numeric?variant.slice(7):variant}.ra`;
  const row=JSON.parse(execFileSync(process.execPath,[script,file,String(limit),mode],{encoding:'utf8'}));
  assert.equal(row.answer,expected);rows.push({variant,mode,limit,answer:row.answer});
 }
}
console.log(JSON.stringify(rows,null,2));
