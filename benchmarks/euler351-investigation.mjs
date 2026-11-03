import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK351_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const [file='demos/euler/351_orchards.ra',mode='compiled',limit='100000000',diag='']=process.argv.slice(2);
let scalarCalls=0,bodyCalls=0;const output=[], kernels=[];const r=new Interpreter(t=>output.push(t.trim()),{compilation:mode!=='reference',args:[`--limit=${limit}`],...(diag?{onScalarFunctionExecuted:()=>scalarCalls++,onFunctionBodyExecuted:()=>bodyCalls++,onIntegerLoopCompiled:s=>kernels.push(s),onScalarCompiled:s=>kernels.push(s),onFunctionBodyCompiled:s=>kernels.push(s)}:{})});
const d=new RuntimeDiagnostics(),t=performance.now(),cpu=process.cpuUsage();
try{const src=readFileSync(file,'utf8');if(diag)d.run(()=>r.execute(src));else r.execute(src);if(limit==='100000000')assert.equal(output.at(-1),'11762187201804552');console.log(JSON.stringify({file,mode,limit,node:process.version,arch:process.arch,ms:performance.now()-t,cpuMs:Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b)/1000,rssMiB:process.resourceUsage().maxRSS/1024,output,...diag?{diagnostics:d,scalarCalls,bodyCalls}:{}}));if(diag && process.env.RANK351_KERNEL_OUTPUT)writeFileSync(process.env.RANK351_KERNEL_OUTPUT,kernels.join('\n\n'));}finally{r.dispose()}
