import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK344_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const [file='original',mode='compiled',n='1000000',c='100',diag='']=process.argv.slice(2);
const source=readFileSync(file==='original'?new URL('experiments/euler344-original.ra',import.meta.url):file,'utf8');
const output=[],kernels=[];const r=new Interpreter(t=>output.push(t.trim()),{compilation:mode!=='reference',args:[`--n=${n}`,`--c=${c}`],...(diag?{onIntegerLoopCompiled:s=>kernels.push(s),onScalarCompiled:s=>kernels.push(s),onFunctionBodyCompiled:s=>kernels.push(s)}:{})});
const d=new RuntimeDiagnostics(),t=performance.now(),cpu=process.cpuUsage();
try{if(diag)d.run(()=>r.execute(source));else r.execute(source);if(n==='1000000'&&c==='100')assert.equal(output.at(-1),'65579304332');console.log(JSON.stringify({file,mode,n,c,node:process.version,arch:process.arch,ms:performance.now()-t,cpuMs:Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b)/1000,rssMiB:process.resourceUsage().maxRSS/1024,output,...diag?{diagnostics:d}:{}}));if(diag && process.env.RANK344_KERNEL_OUTPUT)writeFileSync(process.env.RANK344_KERNEL_OUTPUT,kernels.join('\n\n'));}finally{r.dispose()}
