import {readFileSync, writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
import assert from 'node:assert/strict';
const {Interpreter, RuntimeDiagnostics} = await import(process.env.RUNTIME || new URL('../packages/interpreter/out/index.js', import.meta.url).href);
const [variant='original', n='10000', mode='compiled'] = process.argv.slice(2);
let source=readFileSync(new URL(variant==='production'?'../demos/euler/364_distance.ra':`./experiments/euler364-${variant}.ra`,import.meta.url),'utf8');
const kernels=[], phases=[]; let bodies=0, scalars=0, last=performance.now();
if(process.env.PHASES) source=source.replace('I = array shape', '"factorials" print\nI = array shape').replace('for J in N to 1 by -1','"powers" print\nfor J in N to 1 by -1').replace('Answer = 0','"inverses" print\nAnswer = 0');
const r=new Interpreter(text=>{phases.push({text,ms:performance.now()-last});last=performance.now()}, {args:['--n',n],compilation:mode!=='reference', onFunctionBodyExecuted:()=>bodies++,onScalarFunctionExecuted:()=>scalars++,onIntegerLoopCompiled:s=>kernels.push(s),onFunctionBodyCompiled:s=>kernels.push(s)});
const diagnostics=new RuntimeDiagnostics(); let session;
if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start')}
const start=performance.now();last=start;
try {
 const result=process.env.DIAG?diagnostics.run(()=>r.execute(source)):r.execute(source);
 if(n==='1000000') assert.equal(result,44855254n);
 console.log(JSON.stringify({variant,n,mode,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(result),bodies,scalars,kernels:kernels.length,phases,...(process.env.DIAG?{diagnostics}:{})}));
 if(process.env.KERNELS)writeFileSync(process.env.KERNELS,kernels.join('\n\n'));
 if(session){const {profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile))}
}finally{r.dispose();session?.disconnect()}
