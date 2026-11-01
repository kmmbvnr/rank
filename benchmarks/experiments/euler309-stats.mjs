import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const limit=1000000,top=limit-1,cnt=new Int32Array(limit),groups=[];
function gcd(a,b){while(b){const r=a%b;a=b;b=r;}return a;}
for(let m=2;m*m+1<=top;m++)for(let n=1;n<m&&m*m+n*n<=top;n++){
 if((m+n)%2===0||gcd(m,n)!==1)continue;
 const a=m*m-n*n,b=2*m*n,c=m*m+n*n;groups.push([a,b,Math.floor(top/c)]);
}
for(const [a,b,ks] of groups)for(let k=1;k<=ks;k++){cnt[a*k]++;cnt[b*k]++;}
let total=0,pairs=0,widths=0,maxGroup=0;
const ends=new Int32Array(limit);
for(let w=0;w<limit;w++){total+=cnt[w];ends[w]=total;pairs+=cnt[w]*(cnt[w]-1)/2;if(cnt[w]>=2)widths++;maxGroup=Math.max(maxGroup,cnt[w]);}
const hs=new Int32Array(total),used=new Int32Array(limit);
for(const [a,b,ks] of groups)for(let k=1;k<=ks;k++){hs[ends[a*k]-++used[a*k]]=b*k;hs[ends[b*k]-++used[b*k]]=a*k;}
let answer=0;
for(let w=1;w<limit;w++){
 const start=ends[w]-cnt[w];
 for(let i=start+1;i<ends[w];i++)for(let j=start;j<i;j++)if(hs[i]*hs[j]%(hs[i]+hs[j])===0)answer++;
}
assert.equal(answer,210139);
const result={limit,primitiveTriples:groups.length,storedHeights:total,candidatePairs:pairs,widthsWithPairs:widths,maxGroup,answer,note:'JS Euclid/packed cross-check shares the mathematical enumeration; small brute oracle is independent.'};
writeFileSync(new URL('../baselines/2026-11-01-euler309-stats.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
