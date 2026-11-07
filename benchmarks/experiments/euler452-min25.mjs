import assert from 'node:assert/strict';
import { multiplyWide as multiply } from '../../packages/interpreter/out/runtime/modular-power.js';
const limit=Number(process.argv[2]??1000000000), length=BigInt(process.argv[3]??limit), mod=1234567891;
assert.ok(Number.isInteger(limit) && limit >= 0 && limit <= 2147483647);
assert.ok(length >= 0n);
const start=performance.now(), root=Math.floor(Math.sqrt(limit));
const small=new Int32Array(root+1), large=new Int32Array(root+1), primes=[];
for(let i=1;i<=root;i++){small[i]=i-1;large[i]=Math.floor(limit/i)-1;}
for(let p=2;p<=root;p++)if(small[p]>small[p-1]){
 primes.push(p);const before=small[p-1], square=p*p;
 for(let i=1, end=Math.min(root,Math.floor(limit/square));i<=end;i++){
  const key=i*p;
  large[i]-=(key<=root?large[key]:small[Math.floor(limit/key)])-before;
 }
 for(let v=root;v>=square;v--)small[v]-=small[Math.floor(v/p)]-before;
}
const sieveMs=performance.now()-start;
const coefficients=[1], m=BigInt(mod);
let binomial=1n;
for(let e=1, power=2;power<=limit;e++,power*=2){binomial=binomial*(length+BigInt(e)-1n)/BigInt(e);coefficients.push(Number(binomial%m));}
const pi=value=>value<=root?small[value]:large[Math.floor(limit/value)];
let calls=0, products=0;
function sum(value, first){
 calls++;
 const count=pi(value)-first;
 if(count<=0)return 0;
 let total=multiply(coefficients[1],count,mod);
 for(let i=first;i<primes.length&&primes[i]*primes[i]<=value;i++){
  const prime=primes[i];
  for(let exponent=1, power=prime;power*prime<=value;exponent++,power*=prime){
   products++;
   total=(total+multiply(coefficients[exponent],sum(Math.floor(value/power),i+1),mod)+coefficients[exponent+1])%mod;
  }
 }
 return total;
}
const answer=limit<1?0:length===0n?1:(1+sum(limit,0))%mod;
const checkpoints={10:571,1000000:252903833,1000000000:345558983};
if(length===BigInt(limit)&&checkpoints[limit]!==undefined)assert.equal(answer,checkpoints[limit]);
console.log(JSON.stringify({limit,length:String(length),answer,ms:performance.now()-start,sieveMs,calls,products,rssMiB:process.resourceUsage().maxRSS/1024}));
