// JavaScript controls: same sieve/Fenwick recurrence and Int32 storage.
import assert from 'node:assert/strict';
const [variant='original', size='20000000'] = process.argv.slice(2);
assert(['original','compact'].includes(variant));
const n=Number(size), mod=100000000, compact=variant==='compact';
const start=performance.now();
const phi=new Int32Array(n+1);
for(let i=0;i<=n;i++) phi[i]=i;
for(let p=2;p<=n;p++) if(phi[p]===p) {
    for(let j=p;j<=n;j+=p) phi[j]-=Math.floor(phi[j]/p);
}
const bit=new Int32Array(compact ? Math.floor(n/2)+2 : n+2);
const pre=compact ? phi : new Int32Array(n+1);
pre[1]=0;
for(let k=2;k<=n;k++) {
    const t=phi[k];
    let v=0;
    if(k===6) v=1;
    else {
        let q=compact ? Math.floor(t/2) : t;
        for(;q>0;q-=q&-q) v+=bit[q];
        v=((v-pre[t])%mod+mod)%mod;
    }
    let i=(compact ? Math.floor(t/2) : t)+1;
    for(;i<bit.length;i+=i&-i) {
        bit[i]+=v;
        if(compact) { if(bit[i]>=mod) bit[i]-=mod; }
        else bit[i]%=mod;
    }
    pre[k]=(pre[k-1]+v)%mod;
}
const answer=pre[n];
if(n===20000000) assert.equal(answer,85068035);
console.log(JSON.stringify({variant:`native-${variant}`,mode:'javascript',n,node:process.version,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(answer)}));
