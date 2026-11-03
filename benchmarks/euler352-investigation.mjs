import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK352_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const [file,mode='compiled',size='10000',diag='']=process.argv.slice(2);
const output=[],kernels=[];let scalarCalls=0,bodyCalls=0;
const r=new Interpreter(t=>output.push(t.trim()),{...(process.env.RANK352_NO_SCALAR?{compiler:{scalars:{entries:false,calls:false,functions:false,blockCalls:false}}}:{}),compilation:mode!=='reference',args:[`--size=${size}`],...(diag?{onScalarFunctionExecuted:()=>scalarCalls++,onFunctionBodyExecuted:()=>bodyCalls++,onIntegerLoopCompiled:s=>kernels.push(s),onScalarCompiled:s=>kernels.push(s),onFunctionBodyCompiled:s=>kernels.push(s)}:{})});
const d=new RuntimeDiagnostics(),start=performance.now(),cpu=process.cpuUsage();
try {const src=readFileSync(file,'utf8'); if(diag)d.run(()=>r.execute(src));else r.execute(src);
if(size==='10000')assert.equal(output.at(-1),'378563.260589');
console.log(JSON.stringify({file,mode,size,node:process.version,arch:process.arch,ms:performance.now()-start,cpuMs:Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b)/1000,rssMiB:process.resourceUsage().maxRSS/1024,output,...diag?{diagnostics:d,scalarCalls,bodyCalls}:{}}));
if(diag && process.env.RANK352_KERNEL_OUTPUT)writeFileSync(process.env.RANK352_KERNEL_OUTPUT,kernels.join('\n\n'));
}finally{r.dispose()}
