import {primeMembership} from '../../packages/interpreter/out/runtime/primality.js';
import {primeRange} from '../../packages/interpreter/out/prime-sequence.js';
const [kind='native',count='100000',cap='65536',block='65536']=process.argv.slice(2),n=Number(count),limit=Number(cap),start=10**14;
if(!['native','screen'].includes(kind)||!Number.isInteger(n)||n<1||!Number.isInteger(limit)||limit<2||limit>10000000||!Number.isInteger(Number(block))||Number(block)<2||Number(block)%2)throw Error('arguments');
const cpu=process.cpuUsage(),t=performance.now();let values=[],tested=0;
if(kind==='native') { for(const p of primeRange(BigInt(start),true,undefined,false)){values.push(p);if(values.length===n)break;} }
else {
 const composite=new Uint8Array(limit+1),primes=[];
 for(let p=2;p<=limit;p++){if(composite[p])continue;primes.push(p);for(let m=p*p;m<=limit;m+=p)composite[m]=1;}
 const span=Number(block);
 for(let first=start+1;values.length<n;first+=span){
  const flags=new Uint8Array(span/2);
  for(const p of primes){if(p===2)continue;let m=Math.ceil(first/p)*p;if(m%2===0)m+=p;for(let i=(m-first)/2;i<flags.length;i+=p)flags[i]=1;}
  for(let i=0;i<flags.length&&values.length<n;i++)if(!flags[i]){tested++;const p=BigInt(first+2*i);if(limit>=Math.floor(Math.sqrt(first+span-1))||primeMembership(p))values.push(p);}
 }
}
const usage=process.cpuUsage(cpu),elapsed=performance.now()-t,rssMiB=process.resourceUsage().maxRSS/1024;
let verified=0;
if(process.env.VERIFY&&kind!=='native') {for(const p of primeRange(BigInt(start),true,undefined,false)){if(values[verified]!==p)throw Error(`Prime mismatch at ${verified}`);if(++verified===n)break;}}
console.log(JSON.stringify({verified,kind,count:n,cap:limit,block:Number(block),ms:elapsed,cpuMs:(usage.user+usage.system)/1000,rssMiB,tested,first:String(values[0]),last:String(values.at(-1)),checksum:String(values.reduce((a,b)=>a+b,0n))}));
