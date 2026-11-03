import assert from 'node:assert/strict';
const n=Number(process.argv[2]||100000000),start=performance.now();
const phi=new Uint32Array(n+1);for(let i=0;i<=n;i++)phi[i]=i;
for(let p=2;p<=n;p++)if(phi[p]===p)for(let m=p;m<=n;m+=p)phi[m]-=phi[m]/p;
let sum=0;for(let i=1;i<=n;i++)sum+=phi[i];
assert.ok(Number.isSafeInteger(sum));
const result=6n*(BigInt(n)*BigInt(n+1)/2n-BigInt(sum));
if(n===100000000)assert.equal(result,11762187201804552n);
console.log(JSON.stringify({n,totientSum:String(sum),answer:String(result),ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,oracle:'direct totient sieve through the full bound; no quotient recurrence'}));
