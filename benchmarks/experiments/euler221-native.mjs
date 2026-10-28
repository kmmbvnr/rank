// Diagnostic native control, not the independent oracle.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const runtime=pathToFileURL(resolve(process.argv[2] ?? 'packages/interpreter/out/index.js'));
const {Factorizer}=await import(new URL('./factorization.js',runtime));
const f = new Factorizer();
const values=[];let count=0;const start=performance.now();
for(let p=1n;p<=80000n;p++) {
 const ds=[1n];let previous=0,last=0n,mul=1n;
 for(const q of f.factors(p*p+1n)) {
  if(q!==last){previous=ds.length;last=q;mul=1n;}
  mul*=q;
  for(let i=0;i<previous;i++)ds.push(ds[i]*mul);
 }
 for(const d of ds)if(d<=p){count++;values.push(p*(p+d)*(p+(p*p+1n)/d));}
}
const generated=performance.now();values.sort((a,b)=>a<b?-1:a>b?1:0);
let unique=values.filter((x,i)=>!i||x!==values[i-1]);
console.log(JSON.stringify({generationMs:generated-start,sortMs:performance.now()-generated,count,unique:unique.length,originalAnswer:String(values[149999]),distinctAnswer:String(unique[149999]),rssMiB:process.resourceUsage().maxRSS/1024}));
