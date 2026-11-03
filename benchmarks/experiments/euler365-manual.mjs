const start=performance.now();const sieve=new Uint8Array(5000),ps=[];
for(let p=2;p<5000;p++){if(sieve[p])continue;if(p>=1000)ps.push(p);for(let q=p*p;q<5000;q+=p)sieve[q]=1}
const pow=(a,n,p)=>{let v=1;for(;n;n=Math.floor(n/2),a=a*a%p)if(n%2)v=v*a%p;return v};
const rs=ps.map(p=>{const f=new Int32Array(p);f[0]=1;for(let i=1;i<p;i++)f[i]=f[i-1]*i%p;let a=10n**18n,b=10n**9n,v=1;for(;a+b;a/=BigInt(p),b/=BigInt(p)){const x=Number(a%BigInt(p)),y=Number(b%BigInt(p));if(y>x)return 0;v=v*f[x]%p;v=v*pow(f[y],p-2,p)%p;v=v*pow(f[x-y],p-2,p)%p}return v});
const m=ps.length,inv=new Int32Array(m*m);for(let i=0;i<m;i++)for(let j=i+1;j<m;j++)inv[i*m+j]=pow(ps[i],ps[j]-2,ps[j]);
const setup=performance.now();let sum=0n;
for(let i=0;i<m-2;i++)for(let j=i+1;j<m-1;j++){const p=ps[i],q=ps[j],a=rs[i],t=(rs[j]-a+q)*inv[i*m+j]%q,x=a+p*t,pq=p*q;let part=0;for(let l=j+1;l<m;l++){const r=ps[l],d=rs[l]-x%r+r,u=(d*(inv[i*m+l]*inv[j*m+l]%r))%r;part+=x+pq*u}sum+=BigInt(part)}
console.log(JSON.stringify({answer:String(sum),ms:performance.now()-start,setupMs:setup-start,triplesMs:performance.now()-setup,rssMiB:process.resourceUsage().maxRSS/1024,m,triples:m*(m-1)*(m-2)/6}));
