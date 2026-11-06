import {performance} from 'node:perf_hooks';
const runtimeURL=process.env.RANK440_RUNTIME??new URL('../../packages/interpreter/out/index.js',import.meta.url);
const {Interpreter}=await import(runtimeURL);
const {typedArray}=await import(new URL('array-storage.js',runtimeURL));
const r=new Interpreter(()=>{},{compilation:false});
r.execute('use numbers');
const count=1048576;
const cells=Int32Array.from({length:count},(_,i)=>(Math.imul(i,1664525)+1013904223)>>>1);
r.variables.set('Base',900000007n);r.variables.set('Exponent',typedArray(cells,[1024,1024]));r.variables.set('Mod',987898789n);
try{const times=[];let result;for(let i=0;i<5;i++){const start=performance.now();result=r.execute('Base Exponent Mod powmod');times.push(performance.now()-start);}console.log(JSON.stringify({node:process.version,arch:process.arch,count,times,rssMiB:process.resourceUsage().maxRSS/1024,first:String(result.items[0]),last:String(result.items[count-1])}));}finally{r.dispose();}
