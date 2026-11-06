const {modularConvolve}=await import(process.env.RANK434_CONVOLUTION??new URL('../../packages/interpreter/out/convolution.js',import.meta.url));
const size=Number(process.argv[2]??101),rounds=Number(process.argv[3]??2000),p=1000000033;
const a={cells:Int32Array.from({length:size},(_,i)=>(i*7919+37)%p),shape:[size]};
const b={cells:Int32Array.from({length:size},(_,i)=>(i*104729+11)%p),shape:[size]};
for(let i=0;i<5;i++)modularConvolve(a,b,p);
const start=performance.now();let result;
for(let i=0;i<rounds;i++)result=modularConvolve(a,b,p);
console.log(JSON.stringify({size,rounds,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,last:result.cells.at(-1)}));
