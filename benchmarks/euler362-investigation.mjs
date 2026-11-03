import{readFileSync,writeFileSync}from'node:fs';
import assert from 'node:assert/strict';
import{Session}from'node:inspector/promises';
const{Interpreter,RuntimeDiagnostics}=await import(process.env.RUNTIME||new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const[variant='original',limit='1000000',mode='compiled']=process.argv.slice(2);
let bodies=0,scalars=0;const kernels=[];const r=new Interpreter(()=>{},{args:['--limit',limit],compilation:mode!=='reference',onFunctionBodyExecuted:()=>bodies++,onScalarFunctionExecuted:()=>scalars++,onFunctionBodyCompiled:s=>kernels.push(s),onIntegerLoopCompiled:s=>kernels.push(s)});
const src=readFileSync(new URL(variant==='production'?'../demos/euler/362_squarefree.ra':`./experiments/euler362-${variant}.ra`,import.meta.url),'utf8'),d=new RuntimeDiagnostics();let session;
if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start')}
const t=performance.now();
try{const ans=process.env.DIAG?d.run(()=>r.execute(src)):r.execute(src);if(limit==='10000000000')assert.equal(ans,457895958010n);console.log(JSON.stringify({variant,limit,mode,ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(ans),factorStates:r.variables.get('C')?.entries.size,squarefreeStates:r.variables.get('Q')?.entries.size,...(process.env.DIAG?{diagnostics:d}:{}),bodies,scalars,kernels:kernels.length}));if(process.env.KERNELS)writeFileSync(process.env.KERNELS,kernels.join('\n\n'));if(session){const{profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile))}}finally{r.dispose();session?.disconnect()}
