import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK343_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const [file='original',mode='compiled',limit='2000000',diag='']=process.argv.slice(2);
const source=readFileSync(file==='original'?new URL('../demos/euler/343_fractional.ra',import.meta.url):file,'utf8');
const outputs=[], kernels=[];
const r=new Interpreter(t=>outputs.push(t.trim()),{compilation:mode!=='reference',args:[`--limit=${limit}`],...(diag?{onIntegerLoopCompiled:s=>kernels.push(s),onFunctionBodyCompiled:s=>kernels.push(s)}:{})});
const d=new RuntimeDiagnostics();const t=performance.now(),cpu=process.cpuUsage();
try {if(diag)d.run(()=>r.execute(source));else r.execute(source);if(limit==='2000000')assert.equal(outputs.at(-1),'269533451410884183');console.log(JSON.stringify({file,mode,limit,ms:performance.now()-t,cpuMs:Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b,0)/1000,rssMiB:process.resourceUsage().maxRSS/1024,outputs,...diag?{diagnostics:d}:{}}));if(diag && process.env.RANK343_KERNEL_OUTPUT)writeFileSync(process.env.RANK343_KERNEL_OUTPUT,kernels.join('\n'));
} finally{r.dispose()}
