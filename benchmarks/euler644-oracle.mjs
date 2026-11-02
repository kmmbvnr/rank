// Independent scalar interval oracle; no tensor permutations or prefix scans.
export function solve(lo,hi){
 const rt=Math.SQRT2,st=[0],vs=[0],bp=[];
 for(let a=0;a<=hi+2;a++)for(let b=0;a+b*rt<=hi+2;b++)bp.push(a+b*rt);
 bp.sort((a,b)=>a-b);
 const index=x=>{let a=0,b=st.length;while(a<b){const m=(a+b)>>1;if(st[m]<=x)a=m+1;else b=m;}return Math.max(0,a-1);};
 function sweep(u,measure=false){
  if(u<0)return measure?[0,0]:[];
  let last=index(u);while(last>0&&st[last]>=u)last--;
  let i=1,j=last,ix=0,iy=index(u),left=0,velocity=0;
  let len=0,slope=0;const seen=new Set;
  while(left<u){
   const forward=i<=last?st[i]:Infinity;
   const reverse=j>=1?u-st[j]:Infinity;
   let right,v;
   if(forward<=reverse&&forward<u){right=forward;v=0;i++;}
   else if(reverse<u){right=reverse;v=1;j--;}
   else{right=u;v=1;}
   if(right-left>1e-12){
    const x=(left+right)/2;
    while(ix+1<st.length&&st[ix+1]<=x)ix++;
    while(iy>0&&st[iy]>u-x)iy--;
    const g=vs[ix]^vs[iy];seen.add(g);
    if(g===0){len+=right-left;slope+=v-velocity;}
   }
   left=right;velocity=v;
  }
  return measure?[len,slope]:seen;
 }
 for(let k=0;k<bp.length-1;k++){
  const mid=(bp[k]+bp[k+1])/2;if(mid<1)continue;
  const seen=new Set([...sweep(mid-1),...sweep(mid-rt)]);let g=0;while(seen.has(g))g++;
  if(g!==vs.at(-1)){st.push(bp[k]);vs.push(g);}
 }
 let best=-Infinity,at=lo;
 for(let k=0;k<bp.length-1;k++){
  const a=Math.max(lo,bp[k]),b=Math.min(hi,bp[k+1]);if(b<a)continue;
  const mid=(bp[k]+bp[k+1])/2,[m1,s1]=sweep(mid-1,true),[m2,s2]=sweep(mid-rt,true);
  const c1=m1-s1*(mid-1),c2=m2-s2*(mid-rt);
  const f=x=>x/2*(s1+c1/(x-1)+s2+c2/(x-rt));
  const df=x=>s1+s2-c1/(x-1)**2-rt*c2/(x-rt)**2;
  const cuts=[a,b];
  // f'' can vanish at most once on x > sqrt(2).
  if(c1*c2<0){const t=Math.cbrt(-rt*c2/c1),x=(rt-t)/(1-t);if(x>a&&x<b)cuts.push(x);}
  cuts.sort((a,b)=>a-b);const candidates=[a,b];
  for(let j=1;j<cuts.length;j++){
   let l=cuts[j-1],h=cuts[j];const sign=df(l);
   if(sign*df(h)<0){for(let z=0;z<60;z++){const m=(l+h)/2;if(sign*df(m)>0)l=m;else h=m;}candidates.push((l+h)/2);}
  }
  for(const x of candidates)if(f(x)>best){best=f(x);at=x;}
 }
 return {lo,hi,answer:best.toFixed(8),at,runs:st.length,maxGrundy:Math.max(...vs)};
}
if(import.meta.url===`file://${process.argv[1]}`){const t=performance.now();const result=solve(Number(process.argv[2]??2),Number(process.argv[3]??10));console.log(JSON.stringify({...result,ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024}));};
