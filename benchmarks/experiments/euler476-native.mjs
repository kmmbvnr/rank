// Scalar JS comparison: the same triangle order and per-a sum boundaries.
const n=Number(process.argv[2]??1803),start=performance.now();
let total=0,count=0;
for(let a=1;a<=Math.floor(n/2);a++){
    let subtotal=0;
    for(let b=a;b<=n-a;b++)for(let gap=0;gap<a;gap++){
        const c=b+gap,s=(a+b+c)/2;
        const left=s-a,middle=s-b,right=s-c;
        const r2=left*middle*right/s;
        const sa=(middle*right/(b*c))**0.5,sb=(left*right/(a*c))**0.5;
        const qa=(1-sa)/(1+sa),qb=(1-sb)/(1+sb),q3=Math.max(qb,qa*qa);
        subtotal+=r2*(1+qa*qa+q3*q3);count++;
    }
    total+=subtotal;
}
console.log(JSON.stringify({n,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,
    count,total,answer:Number((total*Math.PI/count).toFixed(5))}));
