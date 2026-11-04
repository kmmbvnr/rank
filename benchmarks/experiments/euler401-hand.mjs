const limit=BigInt(process.argv[2]??'1000000000000000');
const mod=1000000000n,m6=6n*mod;
const start=performance.now();let root=BigInt(Math.floor(Math.sqrt(Number(limit))));
while((root+1n)**2n<=limit)root++;
while(root*root>limit)root--;
let total=0n;
for(let d=1n;d<=root;d++){
 const q=limit/d,x=q%m6;
 const p=x*(x+1n)%m6;
 const s=p*(2n*x+1n)%m6/6n;
 total+=d*d%mod*(q%mod)%mod+s;
}
total-=root*(root*(root+1n)*(2n*root+1n)/6n);
console.log(JSON.stringify({variant:'hand-bigint',limit:String(limit),ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String((total%mod+mod)%mod)}));
