import assert from 'node:assert/strict';
const L=Number(process.argv[2]||25000000000000), ratio=Number(process.argv[3]||1);
const t=performance.now(),top=Math.floor(Math.sqrt(Math.floor(L/3))),spf=new Int32Array(top+1);spf[1]=1;
for(let p=2;p<=top;p++)if(!spf[p]){spf[p]=p;for(let q=p*p;q<=top;q+=p)if(!spf[q])spf[q]=p;}
const sieve=performance.now();let sum=0,smallCandidates=0,modTests=0,blocks=0,divTests=0;
const cut=Math.min(top,Math.floor(Math.cbrt(L)*ratio)),fs=[],ds=[];
for(let p=1;p<=cut;p++){
 const end=Math.min(Math.floor((Math.sqrt(5*p*p)+p)/2),Math.floor((Math.sqrt(4*L-3*p*p)-p)/2));
 fs.length=0;for(let x=p;x>1;){const d=spf[x];fs.push(d);while(x%d===0)x/=d;}
 for(let q=p;q<=end;q++){
  smallCandidates++;let cop=true;for(const d of fs){modTests++;if(q%d===0){cop=false;break;}}
  if(cop)sum+=Math.floor(L/(q*q+p*q+p*p));
 }
}
const small=performance.now();
for(let p=cut+1;p<=top;p++){
 const end=Math.min(Math.floor((Math.sqrt(5*p*p)+p)/2),Math.floor((Math.sqrt(4*L-3*p*p)-p)/2));
 ds.length=1;ds[0]=1;let phi=p;
 for(let x=p;x>1;){const d=spf[x];phi=phi/d*(d-1);const size=ds.length;for(let i=0;i<size;i++)ds.push(-d*ds[i]);while(x%d===0)x/=d;}
 let prev=phi;
 for(let lo=p;lo<=end;){blocks++;const norm=lo*lo+p*lo+p*p,quot=Math.floor(L/norm),bound=Math.floor(L/quot),hi=Math.min(end,Math.floor((Math.sqrt(4*bound-3*p*p)-p)/2));let cop=0;
  for(const d of ds){divTests++;cop+=d>0?Math.floor(hi/d):-Math.floor(hi/-d);}
  sum+=(cop-prev)*quot;prev=cop;lo=hi+1;
 }
}
if (L === 25000000000000) assert.equal(sum, 41791929448408);
console.log(JSON.stringify({L,ratio,answer:sum,ms:performance.now()-t,sieveMs:sieve-t,smallMs:small-sieve,largeMs:performance.now()-small,smallCandidates,modTests,blocks,divTests,rssMiB:process.resourceUsage().maxRSS/1024}));
