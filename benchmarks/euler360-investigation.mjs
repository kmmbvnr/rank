import{readFileSync,writeFileSync}from'node:fs';
import assert from 'node:assert/strict';
import{Session}from'node:inspector/promises';
const{Interpreter,RuntimeDiagnostics}=await import(process.env.RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
// Diagnostic source rewriting only: not a general or production-safe range proof.
if(process.env.INT32){const F=globalThis.Function;globalThis.Function=new Proxy(F,{construct(t,args){let s=args.at(-1);if(typeof s==='string'&&s.includes('cells2 = cells[2]')&&s.includes('const bound2 = cursor')){s=s.replace('const entered = [];','const entered = []; if (r0 !== (r0 | 0)) return undefined; r0 |= 0;').replace(/const (bound\d+) = cursor;/g,'const $1 = cursor | 0;');args[args.length-1]=s}return Reflect.construct(t,args)}})}
const[radius='default',mode='compiled',file=process.cwd()+'/demos/euler/360_sphere.ra']=process.argv.slice(2);
let src=readFileSync(file,'utf8');
if(radius!=='default')src=src.replace('Answer = 2 ** 10 * (5 ** 10 sphere)',`Answer = ${radius} sphere`);
const kernels=[],phases=[];let last=performance.now();
const r=new Interpreter(s=>{phases.push({text:s,ms:performance.now()-last});last=performance.now()},{compilation:mode!=='reference',onIntegerLoopCompiled:s=>kernels.push(s),onFunctionBodyCompiled:s=>kernels.push(s)});
if(process.env.PHASES)src=src.replace('  Total = 0\n  for X in 1 till R','  "chi" print\n  Total = 0\n  for X in 1 till R');
if(process.env.HOT){const at=src.indexOf('\nAnswer =');r.execute(src.slice(0,at));src=src.slice(at);for(let i=0;i<3;i++)r.execute(src);phases.length=0;last=performance.now()}
const d=new RuntimeDiagnostics();let session;
if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start')}
const t=performance.now();try{if(process.env.DIAG)d.run(()=>r.execute(src));else r.execute(src);
if(radius==='default')assert.equal(r.variables.get('Answer'),878825614395267072n);
console.log(JSON.stringify({radius,mode,file,hot:!!process.env.HOT,ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(r.variables.get('Answer')),phases,...(process.env.DIAG?{diagnostics:d,kernels:kernels.length}:{})}));
if(process.env.KERNELS)writeFileSync(process.env.KERNELS,kernels.join('\n\n'));if(session){const{profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile))}
}finally{r.dispose();session?.disconnect()}
