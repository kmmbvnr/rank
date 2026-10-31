import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
// Independent sieve and exhaustive integer classification; no search-tree reuse.
const bound=1000000,spf=new Int32Array(bound),phi=new Int32Array(bound);
for(let i=0;i<bound;i++)phi[i]=i;
for(let p=2;p<bound;p++)if(!spf[p])for(let j=p;j<bound;j+=p){if(!spf[j])spf[j]=p;phi[j]-=phi[j]/p;}
function achilles(n){if(n<2)return false;let g=0;while(n>1){const p=spf[n];let e=0;do{n/=p;e++;}while(n>1&&spf[n]===p);if(e<2)return false;let a=g,b=e;while(b){const r=a%b;a=b;b=r;}g=a;}return g===1;}
const expected=new Map();let count=0;
for(let n=2;n<=bound;n++){if(n>2&&achilles(n-1)&&achilles(phi[n-1]))count++;if([100,1000,10000,100000,1000000].includes(n))expected.set(n,count);}
assert.equal(expected.get(10000),7);
const results=[];
for(const mode of ['compiled','reference'])for(const variant of ['original','reuse','prune','production']){
const source=readFileSync(new URL(variant==='production'?'../../demos/euler/302_strongachilles.ra':`./euler302-${variant}.ra`,import.meta.url),'utf8');
for(const [limit,want] of expected){const rt=new Interpreter(()=>{},{compilation:mode==='compiled'});try{rt.execute(source.replace('10 ** 18',String(limit)));assert.equal(rt.variables.get('Answer'),BigInt(want));results.push({mode,variant,limit,answer:want});}finally{rt.dispose();}}
}
writeFileSync(new URL('../baselines/2026-10-31-euler302-verification.json',import.meta.url),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify({checks:results.length,oracle:Object.fromEntries(expected)}));
