import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const chosen=process.env.RANK487_RUNTIME;
const {Interpreter}=await import(chosen?pathToFileURL(chosen):new URL('../../packages/interpreter/out/index.js',import.meta.url));
if(!global.gc)throw Error('Run with --expose-gc');
const r=new Interpreter(()=>{}), source=readFileSync('demos/euler/487_sumsofpowersums.ra','utf8'), runs=[];
try {
 for(let i=0;i<3;i++) {
  r.execute(i===0?source:'Answer = Primes subtotal rank 0 sum');if(r.variables.get('Answer')!==106650212746n)throw Error('Wrong answer');
  for(let n=0;n<3;n++){global.gc();await new Promise(resolve=>setImmediate(resolve));}
  const m=process.memoryUsage();runs.push({heapMiB:m.heapUsed/1048576,arrayBuffersMiB:m.arrayBuffers/1048576});
 }
 console.log(JSON.stringify({node:process.version,arch:process.arch,runs,rssMiB:process.resourceUsage().maxRSS/1024}));
}finally{r.dispose();}
