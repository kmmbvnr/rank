// Independent sieve of the number of root-contributing prime powers.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const limits=[1,482390,482391,1000000,1983163,10000000];
const top=Math.max(...limits), composite=new Uint8Array(top+1), factors=new Uint8Array(top+1);
for(let p=2;p<=top;p++) {
 if(composite[p]) continue;
 for(let m=p*2;m<=top;m+=p) composite[m]=1;
 if(p%3===1) for(let m=p;m<=top;m+=p) factors[m]++;
}
for(let n=9;n<=top;n+=9) factors[n]++;
const expected=new Map();
let sum=0n;
for(let n=1;n<=top;n++) {
 if(factors[n]===5) sum+=BigInt(n);
 if(limits.includes(n)) expected.set(n,String(sum));
}
for(const variant of (process.env.VARIANTS??'original,scaled,tight,batched-tight').split(',')) for(const mode of ['reference','compiled']) for(const limit of limits) {
 const child=spawnSync(process.execPath,[fileURLToPath(new URL('./euler272-investigation.mjs',import.meta.url)),mode,variant,String(limit)],{encoding:'utf8',timeout:60000,env:{...process.env,STAGES:'',DIAGNOSTICS:''}});
 assert.equal(child.status,0,child.stderr||String(child.error));
 const result=JSON.parse(child.stdout);
 assert.equal(result.answer,expected.get(limit),`${variant}/${mode}/${limit}`);
 console.log(JSON.stringify({variant,mode,limit,answer:result.answer}));
}
