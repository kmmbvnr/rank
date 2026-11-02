// Research worker; pass RANK338_RUNTIME to select an isolated build.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK338_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const [variant='original',mode='compiled',limit='1000000000000',diag='']=process.argv.slice(2);
const original=readFileSync(new URL('experiments/euler338-refresh-original.ra',import.meta.url),'utf8');
let source=variant==='production'?readFileSync(new URL('../demos/euler/338_gridpaper.ra',import.meta.url),'utf8'):variant==='original'?original:readFileSync(new URL(`experiments/euler338-refresh-${variant}.ra`,import.meta.url),'utf8');
const kernels=[]; const out=[];
if(diag) {const NativeFunction=globalThis.Function;globalThis.Function=new Proxy(NativeFunction,{construct(target,args){kernels.push(String(args.at(-1)));return Reflect.construct(target,args)}})}
const r=new Interpreter(s=>out.push(s.trim()),{compilation:mode!=='reference',args:[`--limit=${limit}`],...(diag?{onIntegerLoopCompiled:s=>kernels.push(s),onScalarCompiled:s=>kernels.push(s),onFunctionBodyCompiled:s=>kernels.push(s)}:{})});
const d=new RuntimeDiagnostics(); const start=performance.now();
try {if(diag)d.run(()=>r.execute(source));else r.execute(source);
const gold=new Map([['1000000','999896100908'],['100000000','9999981809448105'],['10000000000','99999997195292891339'],['1000000000000','999999999600010915614292']]);
if(gold.has(limit))assert.equal(out.at(-1),gold.get(limit));
console.log(JSON.stringify({variant,mode,limit,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:out.at(-1),...(diag?{diagnostics:d}:{})}));
if(diag && process.env.RANK338_KERNEL_OUTPUT)writeFileSync(process.env.RANK338_KERNEL_OUTPUT,kernels.join('\n\n'));
}finally{r.dispose()}
