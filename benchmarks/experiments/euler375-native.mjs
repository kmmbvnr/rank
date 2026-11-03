import assert from 'node:assert/strict';
const start=performance.now(),P=6308948,N=2000000000,M=50515093;
const a=new Int32Array(P),st=new Int32Array(P);let s=290797,low=M,k=0;
for(let i=0;i<P;i++){s=s*s%M;a[i]=s;if(s<low){low=s;k=i;}}
let top=0,sum=0,total=0,first=0,prefix=0,warm=0,warmRest=0,nextRest=0,maxTop=0;
const q=Math.floor(N/P),rest=N%P,cut=Math.min(k,rest);
for(let i=0;i<P+k;i++){
 let x=a[i%P]-low;
 while(top>0){let j=st[top-1],y=a[j%P]-low;if(y<x)break;top--;let left=top>0?st[top-1]:-1;sum-=y*(j-left);}
 let left=top>0?st[top-1]:-1;sum+=x*(i-left);st[top++]=i;maxTop=Math.max(maxTop,top);total+=sum;
 if(i+1===rest)prefix=total;
 if(i+1===k)warm=total;
 if(i+1===cut)warmRest=total;
 if(i+1===P)first=total;
 if(i+1===P+cut)nextRest=total-first;
}
let answer=BigInt(low)*BigInt(N)*BigInt(N+1)/2n+BigInt(prefix);
if(q>0)answer+=BigInt(q)*BigInt(first)+BigInt(q-1)*BigInt(total-first-warm)+BigInt(nextRest-warmRest);
assert.equal(answer,7435327983715286168n);assert.ok(Number.isSafeInteger(total));
console.log(JSON.stringify({native:true,ms:performance.now()-start,rss:process.resourceUsage().maxRSS/1024,answer:String(answer),low,k,maxTop,total,first}));
