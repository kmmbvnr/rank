import {safeIntegerModularPower as power} from '../../packages/interpreter/out/runtime/modular-power.js';
import {multiply} from '../../packages/interpreter/out/runtime/modular-power.js';
const n=Number(process.argv[2]??100000000000),requested=Number(process.argv[3]??10000000),M=100000000;
const root=Math.floor(Math.sqrt(n)),limit=Math.min(n,Math.max(requested,root+2));
const start=performance.now(),stages=[];let previous=start;
const phase=name=>{const now=performance.now();stages.push({name,ms:now-previous});previous=now;};
const mod=x=>{const r=x%M;return r<0?r+M:r;};
const mul=(a,b,m=M)=>multiply(a,b,m);
const tri=x=>{const odd=x%2;return mul(x/(2-odd)%M,(x+1)/(1+odd)%M);};
const sqs=x=>{const m=6*M;return mul(mul(x%m,(x+1)%m,m),(2*x+1)%m,m)/6;};
let phi=new Int32Array(limit+1);for(let i=0;i<=limit;i++)phi[i]=i;
for(let p=2;p<=limit;p++)if(phi[p]===p)for(let j=p;j<=limit;j+=p)phi[j]-=Math.floor(phi[j]/p);
phase('sieve');
const c0=new Int32Array(limit+1),c1=new Int32Array(limit+1),c2=new Int32Array(limit+1);
for(let i=1;i<=limit;i++){
 const f0=phi[i]%M,f1=mul(i%M,f0),f2=mul(i%M,f1);
 c0[i]=(c0[i-1]+f0)%M;c1[i]=(c1[i-1]+f1)%M;c2[i]=(c2[i-1]+f2)%M;
}
phi=undefined;phase('prefix');
const count=Math.floor(n/limit),l0=new Int32Array(count+2),l1=new Int32Array(count+2),l2=new Int32Array(count+2);
for(let i=count;i>=1;i--){
 const x=Math.floor(n/i);if(x<=limit)continue;
 const r=Math.floor(Math.sqrt(x));let a0=0,a1=0,a2=0,b0=0,b1=0,b2=0;
 for(let k=2;k<=r;k++){
  const q=Math.floor(x/k),index=i*k;
  const v0=q<=limit?c0[q]:l0[index],v1=q<=limit?c1[q]:l1[index],v2=q<=limit?c2[q]:l2[index];
  a0+=v0;a1+=mul(k%M,v1);a2+=mul(mul(k%M,k%M),v2);
 }
 const qmax=Math.floor(x/(r+1));
 for(let q=1;q<=qmax;q++){
  const hi=Math.floor(x/q),lo=Math.max(r,Math.floor(x/(q+1)));
  b0+=mul((hi-lo)%M,c0[q]);b1+=mul(mod(tri(hi)-tri(lo)),c1[q]);b2+=mul(mod(sqs(hi)-sqs(lo)),c2[q]);
 }
 const t=tri(x);l0[i]=mod(t-a0-b0);l1[i]=mod(sqs(x)-a1-b1);l2[i]=mod(mul(t,t)-a2-b2);
}
phase('cache');
const nm=(n+1)%M,na=mul(4,mul(nm,nm));let sum1=0,sum2=0;
for(let l=1;l<=root;l++){
 const q=Math.floor(n/l),g0=q<=limit?c0[q]:l0[l],g1=q<=limit?c1[q]:l1[l],g2=q<=limit?c2[q]:l2[l];
 const nb=mul(mul(6,nm),l%M),l2mod=mul(l%M,l%M);
 const p=mod(mul(na,g0)-mul(nb,g1)+mul(mul(2,l2mod),g2));
 sum1+=mul(p,mod(power(2,l-1,M)-1));
}
const bound=Math.floor(n/(root+1));
for(let q=1;q<=bound;q++){
 const hi=Math.floor(n/q),lo=Math.max(root,Math.floor(n/(q+1))),bm=hi%M,am=lo%M;
 const tb=power(2,hi,M),ta=power(2,lo,M);
 const ca=mul(na,c0[q]),cb=mod(-mul(mul(6,nm),c1[q])),cc=mul(2,c2[q]);
 const e0=mod(tb-ta),e1=mod(mul(mod(bm-1),tb)-mul(mod(am-1),ta));
 const e2=mod(mul(mod(mul(bm,bm)-2*bm+3),tb)-mul(mod(mul(am,am)-2*am+3),ta));
 sum2+=mul(ca,mod(e0-(hi-lo)))+mul(cb,mod(e1-tri(hi)+tri(lo)))+mul(cc,mod(e2-sqs(hi)+sqs(lo)));
}
phase('combine');
let exponent=(BigInt(n)+1n)**2n,factor=2n,pow=1n;const bigMod=BigInt(M);
while(exponent){if(exponent&1n)pow=pow*factor%bigMod;factor=factor*factor%bigMod;exponent>>=1n;}
const answer=mod(Number(pow)-mod(1+mul(nm,nm)+sum1+sum2));
console.log(JSON.stringify({n,limit,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer,stages}));
