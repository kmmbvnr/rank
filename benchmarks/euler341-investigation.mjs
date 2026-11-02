import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK341_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const [variant='original',mode='compiled',count='1000000',diag='']=process.argv.slice(2);
const file=new URL(variant==='production'?'../demos/euler/341_golomb.ra':`experiments/euler341-${variant==='term'?'original':variant}.ra`,import.meta.url);
const source=readFileSync(file,'utf8').replace('Count cubes print',variant==='term'?'Count term print':'Count cubes print');
const output=[],kernels=[];
if(diag){const F=globalThis.Function;globalThis.Function=new Proxy(F,{construct(t,a){kernels.push(String(a.at(-1)));return Reflect.construct(t,a)}})}
const r=new Interpreter(t=>output.push(t.trim()),{compilation:mode!=='reference',args:[`--count=${count}`],...(diag?{onIntegerLoopCompiled:s=>kernels.push(s),onScalarCompiled:s=>kernels.push(s),onFunctionBodyCompiled:s=>kernels.push(s)}:{})});
const d=new RuntimeDiagnostics(),start=performance.now();
try{if(diag)d.run(()=>r.execute(source));else r.execute(source);if(count==='1000000')assert.equal(output.at(-1),variant==='term'?'6137':'56098610614277014');
if(count==='10000' && variant!=='term')assert.equal(output.at(-1),'109822485241');
if(count==='1000')assert.equal(output.at(-1),variant==='term'?'86':'153506976');
console.log(JSON.stringify({variant,mode,count,node:process.version,arch:process.arch,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,output,...(diag?{diagnostics:d}:{})}));if(diag && process.env.RANK341_KERNEL_OUTPUT)writeFileSync(process.env.RANK341_KERNEL_OUTPUT,kernels.join('\n\n'));}finally{r.dispose()}
