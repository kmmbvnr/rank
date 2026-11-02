import assert from 'node:assert/strict';
export function oracle(n) {
const limit=Math.max(100,n-1-Math.max(0,Math.floor(4*n/5)-20));
const heights=new Int32Array(limit+1),long=new Float64Array(limit+1),short=new Float64Array(limit+1);short.fill(-1e12);
const off=Array.from({length:limit+1},()=>new Float64Array(17).fill(-1e12)); off[0][0]=off[1][0]=0;
let h=1,p=2;for(let s=2;s<=limit;s++){if(s>=p*2){p*=2;h++}heights[s]=h;let l,r;if(s>=p+p/2){l=p-1;r=s-1-l}else{r=p/2-1;l=s-1-r}for(let d=0;d<h;d++)off[s][d+1]=Math.max(off[l][d]+l+1,off[r][d]+(d+1)*(l+1));long[s]=off[s][h];short[s]=off[s][h-1];}
const dp=new Float64Array(n+1);let sum=0,visits=0,monotone=true;
for(let s=15;s<=limit;s+=8)if(heights[s]===heights[s-8])assert.ok(short[s]-heights[s]*s<=short[s-8]-heights[s]*(s-8));
for(let i=2;i<=n;i++){let best=1e12;const last=i-1-Math.max(0,Math.floor(4*i/5)-20),step=i<=100?1:8,first=i<=100?0:7;
for(let s=first;s<=last;s+=step){const k=i-1-s,h=heights[s];let right=long[s]+h*(k+1);if(h)right=Math.max(right,short[s]+(h-1)*(k+1));best=Math.min(best,k+1+Math.max(dp[k],right));visits++;}
dp[i]=best;sum+=best;monotone&&=dp[i]>=dp[i-1];}
assert.ok(monotone);return {dp,sum,visits};
}
export function interval(n){
 const c=Array.from({length:n+2},()=>new Float64Array(n+2));
 for(let len=2;len<=n;len++)for(let lo=1;lo+len-1<=n;lo++){let hi=lo+len-1,best=Infinity;for(let k=lo;k<=hi;k++)best=Math.min(best,k+Math.max(c[lo][k-1],c[k+1][hi]));c[lo][hi]=best;}
 return c[1];
}
