const R=9765625, max=2*R,t=performance.now(),chi=new Int32Array(max+1);
for(let x=1;x*x<=max;x++){
 const x2=x*x;chi[x2]++;
 for(let y=1;y<x;y++){const n=x2+y*y;if(n>max)break;chi[n]+=2}
 if(2*x2<=max)chi[2*x2]++;
}
const build=performance.now()-t;let total=0;
for(let x=1;x<R;x++)if(x%4!==2){let a=chi[R-x],b=chi[R+x];if(a>0&&b>0){let w=a*b;if(x%5===0){let z=x,v=0;while(z%5===0){z/=5;v++}w=Math.floor(w*(2*v+1)/((v+1)**2))}total+=x*w}}
console.log(JSON.stringify({ms:performance.now()-t,build,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(BigInt(6*R+24*total)*1024n)}));
