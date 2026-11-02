import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK348_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const [file='demos/euler/348_squarecube.ra',mode='compiled',want='5',diag='']=process.argv.slice(2);
const output=[], kernels=[];const r=new Interpreter(t=>output.push(t.trim()),{compilation:mode!=='reference',args:[`--want=${want}`],...(diag?{onIntegerLoopCompiled:s=>kernels.push(s),onScalarCompiled:s=>kernels.push(s),onFunctionBodyCompiled:s=>kernels.push(s)}:{})});
const d=new RuntimeDiagnostics(),t=performance.now(),cpu=process.cpuUsage();
try{const src=readFileSync(file,'utf8');if(diag)d.run(()=>r.execute(src));else r.execute(src);if(want==='5')assert.equal(output.at(-1),'1004195061');console.log(JSON.stringify({file,mode,want,node:process.version,arch:process.arch,ms:performance.now()-t,cpuMs:Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b)/1000,rssMiB:process.resourceUsage().maxRSS/1024,output,...diag?{diagnostics:d}:{}}));if(diag && process.env.RANK348_KERNEL_OUTPUT)writeFileSync(process.env.RANK348_KERNEL_OUTPUT,kernels.join('\n\n'));}finally{r.dispose()}
