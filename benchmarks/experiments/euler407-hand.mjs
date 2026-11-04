import os from 'node:os';
const N=Number(process.argv[2]??1e7);const start=performance.now();
const root=Math.floor(Math.sqrt(N)),big=2*N+5,phi=Int32Array.from({length:root+1},(_,i)=>i);
for(let p=2;p<=root;p++)if(phi[p]===p)for(let j=p;j<=root;j+=p)phi[j]-=Math.floor(phi[j]/p);
const least=new Int32Array(N+1).fill(big);
for(let u=2;u<=root;u++){
 const hi=Math.floor(N/u),inv=new Int32Array(u);
 for(let r=0;r<u;r++){let x=1,p=r,e=phi[u]-1;while(e>0){if(e%2===1)x=x*p%u;p=p*p%u;e=Math.floor(e/2);}if(x*r%u===1)inv[r]=x;}
 for(let v=u+1;v<=hi;v++){const i=inv[v%u];if(i===0)continue;const n=u*v,e=v*i,c=Math.min(e,n+1-e);if(c<least[n])least[n]=c;}
}
let answer=0;for(let n=2;n<=N;n++)answer+=least[n]<big?n+1-least[n]:1;
console.log(JSON.stringify({N,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer,cpu:os.cpus()[0].model}));
