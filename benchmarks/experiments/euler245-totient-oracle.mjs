import assert from 'node:assert/strict';
const limit=10_000_000, phi=new Uint32Array(limit+1);
for(let n=1;n<=limit;n++)phi[n]=n;
for(let p=2;p<=limit;p++)if(phi[p]===p)for(let n=p;n<=limit;n+=p)phi[n]-=phi[n]/p;
const queries=[10,14,15,84,85,100,1000,10000,100000,1000000,10000000];let sum=0,count=0;const results=[];
for(let n=4;n<=limit;n++){
 if(phi[n]!==n-1&&(n-1)%(n-phi[n])===0){sum+=n;count++;}
 if(queries.includes(n))results.push({limit:n,sum,count});
}
assert.equal(results.find(r=>r.limit===100000).sum,595394);
assert.equal(sum,275069018);
console.log(JSON.stringify(results));
