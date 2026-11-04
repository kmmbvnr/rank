const K=Number(process.argv[2]??10000),mod=10n**18n;
const t=performance.now();const g=new Int32Array(K+1);if(K>=2)g[2]=1;
for(let n=3;n<=K;n++)g[n]=(1+g[n-1])^(1+g[n-2]);
let stride=1;for(let m=Math.max(...g);stride<=m+1;stride*=2){}
let prev=new BigInt64Array(stride+1),older=new BigInt64Array(stride+1),curr=new BigInt64Array(stride+1);
prev[0]=older[0]=curr[0]=1n;if(K>=2)prev[1]=1n;
for(let n=3;n<=K;n++) {const a=1+g[n-1],b=1+g[n-2];for(let j=0;j<stride;j++){let v=prev[j^b]+older[j^a];if(v>=mod)v-=mod;curr[j+1]=v;}[older,prev,curr]=[prev,curr,older];}
console.log(JSON.stringify({K,stride,answer:String(prev[1]),ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024}));
