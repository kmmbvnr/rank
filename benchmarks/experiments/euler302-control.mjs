import assert from 'node:assert/strict';
// Exact-product JavaScript control of the original descending-prime search.
// Exponents and primes fit in Number; all number products use BigInt.
const power=Number(process.argv[2]??12);assert(Number.isInteger(power)&&power>=2&&power<=18);
const limit=10n**BigInt(power),start=performance.now();let root=Math.floor(Math.cbrt(Number(limit)));
while(BigInt(root+1)**3n<limit)root++;while(BigInt(root)**3n>=limit)root--;
const sieve=new Uint8Array(root+1),pr=[];
for(let p=2;p<=root;p++)if(!sieve[p]){pr.push(p);for(let j=p*p;j<=root;j+=p)sieve[j]=1;}
const cache=new Map();let nodes=0,candidates=0;
function gcd(a,b){while(b){const t=a%b;a=b;b=t;}return a;}
function factors(x){if(cache.has(x))return cache.get(x);const key=x,fs=[];for(const p of pr){if(p*p>x)break;while(x%p===0){fs.push(p);x/=p;}}if(x>1)fs.push(x);cache.set(key,fs);return fs;}
function g(n,fs,gn,gp,max){nodes++;let total=0;let cnt=new Map();for(const p of fs)cnt.set(p,(cnt.get(p)??0)+1);
if(gn===1){let h=gp,ok=true;for(const e of cnt.values()){if(e<2){ok=false;break;}h=gcd(h,e);}if(ok&&h===1)total++;}
for(let i=0;i<=max;i++){candidates++;const p=pr[i],b=BigInt(p);let pow=b*b;if(n*pow>=limit)break;const have=cnt.get(p)??0;let exp=2;if(!have){pow*=b;exp++;}if(n*pow>=limit)continue;
let g2=gp,ok=true;for(const [q,e] of cnt)if(q>p){if(e<2){ok=false;break;}g2=gcd(g2,e);}if(!ok)continue;
const f2=fs.filter(q=>q<p).concat(factors(p-1));
while(n*pow<limit){total+=g(n*pow,f2,gcd(gn,exp),gcd(g2,have+exp-1),i-1);pow*=b;exp++;}}
return total;}
const answer=g(1n,[],0,0,pr.length-1);if(power===4)assert.equal(answer,7);if(power===8)assert.equal(answer,656);
console.log(JSON.stringify({power,answer,nodes,candidates,factorCache:cache.size,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024}));
