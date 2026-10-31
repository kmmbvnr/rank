const limit=Number(process.argv[2]??10000),early=process.argv[3]==='early',t=performance.now();let sum=0n,expanded=0,discovered=0,edges=0,maxValue=0n,maxAt=0,unsafe=0;
for(let n=1;n<=limit;n++){
 const p=new Int32Array(n).fill(-1),d=new Int8Array(n),q=new Int32Array(n);let head=0,tail=0;
 for(let x=1;x<=2;x++){let r=x%n;if(p[r]===-1){p[r]=n;d[r]=x;q[tail++]=r;discovered++;}}
 while(head<tail){let r=q[head++];if(early?p[0]!==-1:r===0)break;expanded++;for(let x=0;x<=2;x++){edges++;let next=(10*r+x)%n;if(p[next]===-1){p[next]=r;d[next]=x;q[tail++]=next;discovered++;}}}
 let r=0,value=0n,place=1n;while(r<n){value+=BigInt(d[r])*place;place*=10n;r=p[r];}
 if(value>maxValue){maxValue=value;maxAt=n;}if(value>BigInt(Number.MAX_SAFE_INTEGER))unsafe++;sum+=value/BigInt(n);
}
console.log(JSON.stringify({limit,early,answer:String(sum),ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024,expanded,discovered,edges,maxValue:String(maxValue),maxAt,unsafe}));
