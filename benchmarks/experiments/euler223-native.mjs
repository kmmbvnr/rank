const L=Number(process.argv[2]??30000);let ans=0, nodes=0,maxdepth=0,maxwidth=0,levels=0;const start=performance.now();
for(let root=1;root<=2;root++) {let cnt=0,same=root===1?1:0;let cur=[];
 for(let b=root;b<=Math.floor((L-1)/2);b+=2){cnt++;if(12*b+5<=L)cur.push([4*b+1,3*b+2,5*b+2]);if(!(root===1&&b===1)&&12*b-5<=L)cur.push([4*b-1,3*b-2,5*b-2]);}
 let depth=0;while(cur.length){levels++;maxwidth=Math.max(maxwidth,cur.length);cnt+=cur.length;nodes+=cur.length;const next=[];for(const [a,b,c] of cur){if(a===b)same++;let k=0;for(const [x,y,z] of [[a-2*b+2*c,2*a-b+2*c,2*a-2*b+3*c],[a+2*b+2*c,2*a+b+2*c,2*a+2*b+3*c],[-a+2*b+2*c,-2*a+b+2*c,-2*a+2*b+3*c]])if((++k!==3||root!==1||a!==b)&&x+y+z<=L)next.push([x,y,z]);}cur=next;depth++;}maxdepth=Math.max(maxdepth,depth);ans+=cnt;
}console.log(JSON.stringify({L,ans,ms:performance.now()-start,nodes,maxdepth,maxwidth,levels}));
