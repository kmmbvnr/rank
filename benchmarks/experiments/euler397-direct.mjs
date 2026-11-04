// Manual JS control: same divisor generation, pruning and exact final sum.
const K=Number(process.argv[2]??1000000), X=Number(process.argv[3]??1000000000);
const start=performance.now(),spf=new Int32Array(K+1),ds=new Float64Array(8*(Math.floor(Math.sqrt(K))+1));
for(let p=2;p<=K;p++)if(!spf[p])for(let n=p;n<=K;n+=p)if(!spf[n])spf[n]=p;
let answer=0n;ds[0]=1;
for(let n=1;n<=K;n++){
 const d0=2*n*n;let count=1,rest=n,p=2,exponent=1;
 while(p>0){
  while(rest%p===0){rest/=p;exponent+=2;}
  const previous=count;let power=1;
  for(let e=1;e<=exponent;e++){power*=p;for(let j=0;j<previous;j++)ds[count++]=ds[j]*power;}
  p=rest>1?spf[rest]:0;exponent=0;
 }
 let total=0;const range=2*X;
 for(let i=0;i<count;i++){
  const d=ds[i],u=d0/d,s=n-u,t=d-n;
  if(s>=-range&&s<=range&&t>=-range&&t<=range){
   const lo=Math.max(t-X,-X),hi=Math.min(s+X,X,Math.floor((s-1)/2));
   if(hi>=lo)total+=2*(hi-lo+1);
   if(u>2*n){const den=s+n;if(d0%den===0){
    const v=n-Math.floor(d0/den);
    if((s+t-v)%2===0){const a=(s+t-v)/2,b=(s+v-t)/2,c=(t+v-s)/2;
     if(a>=-X&&a<b&&b<c&&c<=X)total-=2;
    }
   }}
   if(d<2*n){const den=n-t;if(d0%den===0){
    const v=d0/den-n;
    if((s+t-v)%2===0){const a=(s+t-v)/2,b=(s+v-t)/2,c=(t+v-s)/2;
     if(a>=-X&&a<b&&b<c&&c<=X)total--;
    }
   }}
  }
  const p=-(n+u),q=n+d;
  if(p>=-range&&q<=range){const lo=Math.max(p-X,-X,q-X,Math.floor(p/2)+1),hi=Math.min(p+X,X,Math.floor((q-1)/2));
   if(hi>=lo)total+=hi-lo+1;
  }
 }
 if(!Number.isSafeInteger(total))throw Error('unsafe per-row total');
 answer+=BigInt(total);
}
console.log(JSON.stringify({mode:'manual-js',K,X,answer:String(answer),ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024}));
