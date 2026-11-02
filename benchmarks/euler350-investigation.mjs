import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK350_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const [file='demos/euler/350_constraining.ra',mode='compiled',g='1000000',diag='']=process.argv.slice(2);
const output=[], kernels=[];const r=new Interpreter(t=>output.push(t.trim()),{compilation:mode!=='reference',args:[`--g=${g}`],...(diag?{onIntegerLoopCompiled:s=>kernels.push(s),onScalarCompiled:s=>kernels.push(s),onFunctionBodyCompiled:s=>kernels.push(s)}:{})});
const d=new RuntimeDiagnostics(),t=performance.now(),cpu=process.cpuUsage();
try{const src=readFileSync(file,'utf8');if(diag)d.run(()=>r.execute(src));else r.execute(src);if(g==='1000000')assert.equal(output.at(-1),'84664213');console.log(JSON.stringify({file,mode,g,node:process.version,arch:process.arch,ms:performance.now()-t,cpuMs:Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b)/1000,rssMiB:process.resourceUsage().maxRSS/1024,output,...diag?{diagnostics:d}:{}}));if(diag && process.env.RANK350_KERNEL_OUTPUT)writeFileSync(process.env.RANK350_KERNEL_OUTPUT,kernels.join('\n\n'));}finally{r.dispose()}
