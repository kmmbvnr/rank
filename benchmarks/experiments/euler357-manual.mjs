const {DensePrimeSieve}=await import(process.env.SIEVE_RUNTIME || new URL('../../packages/interpreter/out/runtime/dense-prime-sieve.js', import.meta.url).href);
const limit=Number(process.argv[2]||1e8),mode=process.argv[3]||'number';
const t=performance.now();const sieve=new DensePrimeSieve(limit+1);const built=performance.now();let sum=limit>=1?1:0, trials=0, candidates=0;
for(let n=2;n<=limit;n+=4){if(!sieve.contains(n+1)||!sieve.contains(2+n/2))continue;candidates++;let good=true;
for(let d=3;d*d<=n;d++){trials++;if(n%d===0&&!sieve.contains(d+n/d)){good=false;break}}
if(good)sum+=n;}
console.log(JSON.stringify({limit,mode,ms:performance.now()-t,sieveMs:built-t,answer:sum,trials,candidates,rssMiB:process.resourceUsage().maxRSS/1024}));
