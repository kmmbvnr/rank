const limit=Number(process.argv[2]||1000),stride=limit+1;let a=new Int32Array(stride*(limit+2)),b=new Int32Array(a.length),answer=0,cells=0,swaps=0,rounds=0,maxS=0;for(let v=0;v<=limit;v++)a[v]=b[v]=v;
const start=performance.now();let ms=[];
for(let n=1;n<=limit;n++){const step=n+1;for(let s=1;s<=step;s++){rounds++;maxS=Math.max(maxS,s);for(let m=1;m<=s;m++){const add=s-m+1,prev=(m-1)*stride,cur=m*stride;for(let v=0;v<=n;v++){let x=b[prev+v]+add;if(x>=step)x=0;b[cur+v]=a[prev+x];cells++;}}let val=b[s*stride],same=true;for(let v=1;v<=n;v++)if(b[s*stride+v]!==val){same=false;break;}if(same){answer+=val**3;ms.push(val);break;}[a,b]=[b,a];swaps++;}}
console.log(JSON.stringify({limit,answer,cells,swaps,rounds,maxS,ms,runtime:performance.now()-start,rss:process.resourceUsage().maxRSS/1024}));
