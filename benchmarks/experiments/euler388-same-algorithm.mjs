import assert from 'node:assert/strict';
const n=Number(process.argv[2]??10000000000),cut=Number(process.argv[3]??4641589);
const start=performance.now();
const mu=new Int32Array(cut+1), primes=[];
mu.fill(2);mu[0]=0;mu[1]=1;
for(let i=2;i<=cut;i++){
 if(mu[i]===2){primes.push(i);mu[i]=-1;}
 for(const p of primes){const v=i*p;if(v>cut)break;if(i%p===0){mu[v]=0;break;}mu[v]=-mu[i];}
}
for(let i=1;i<=cut;i++)mu[i]+=mu[i-1];
const top=Math.floor(n/(cut+1)), cache=new Int32Array(top+1);
let recurrenceGroups=0,sumGroups=0;
for(let slot=top;slot>=1;slot--){
 const x=Math.floor(n/slot);let total=1;
 for(let l=2;l<=x;){const q=Math.floor(x/l),r=Math.floor(x/q),part=q<=cut?mu[q]:cache[Math.floor(n/q)];
  recurrenceGroups++;const term=(r-l+1)*part;assert(Number.isSafeInteger(term));total-=term;assert(Number.isSafeInteger(total));l=r+1;}
 assert(total>=-2147483648&&total<=2147483647);cache[slot]=total;
}
let answer=0n,before=0;
for(let l=1;l<=n;){const q=Math.floor(n/l),r=Math.floor(n/q),m=r<=cut?mu[r]:cache[Math.floor(n/r)];
 sumGroups++;answer+=BigInt(m-before)*((BigInt(q)+1n)**3n-1n);before=m;l=r+1;
}
if(n===10000000000)assert.equal(answer,831907372771451255456805129931n);
console.log(JSON.stringify({n,cut,recurrenceGroups,sumGroups,answer:String(answer),ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024}));
