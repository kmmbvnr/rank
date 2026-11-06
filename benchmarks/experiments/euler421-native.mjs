// Control: same prime iterator and exact modular helper as Rank, no language frames.
import {primeRange} from '../../packages/interpreter/out/prime-sequence.js';
import {safeIntegerModularPower as powmod,multiply} from '../../packages/interpreter/out/modular-power.js';
const N=Number(process.argv[2]??100000000000),M=Number(process.argv[3]??100000000);
if(!Number.isSafeInteger(N)||N<0||M<0||M>1e8)throw Error('control domain');
const start=performance.now();let answer=0n,primes=0,maxBase=0;
for(const integer of primeRange(2n,true,BigInt(M),true)){
 const p=Number(integer),order=(p-1)%3===0?((p-1)%5===0?15:3):((p-1)%5===0?5:1);primes++;
 if(order===1){answer+=BigInt(p*Math.floor((N+1)/p));continue;}
 const exponent=(p-1)/order;let root=0;
 for(let base=2;base<p;base++){
  const candidate=powmod(base,exponent,p);
  if(candidate<=1)continue;
  if(order===15&&(powmod(candidate,3,p)===1||powmod(candidate,5,p)===1))continue;
  root=candidate;maxBase=Math.max(maxBase,base);break;
 }
 if(!root)throw Error('missing root');
 let power=1,total=0;
 for(let j=0;j<order;j++){
  const residue=p-power;total+=p*Math.floor((N+p-residue)/p);power=multiply(power,root,p);
 }
 answer+=BigInt(total);
}
console.log(JSON.stringify({N,M,answer:String(answer),primes,maxBase,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024}));
