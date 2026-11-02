import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Session} from 'node:inspector/promises';
const root=process.env.RANK_ROOT||fileURLToPath(new URL('..',import.meta.url));
const {Interpreter,RuntimeDiagnostics}=await import(`${root}/packages/interpreter/out/index.js`);
const [mode='compiled',n='200000',variant='current']=process.argv.slice(2);
const path=fileURLToPath(new URL(variant==='final'?'../demos/euler/328_lowestcost.ra':`experiments/euler328-${variant}.ra`,import.meta.url));
const source=readFileSync(path,'utf8').replace('Answer = 200000 costs',`Answer = ${n} costs`);
const {withInterrupt,InterruptedError}=await import(`${root}/packages/interpreter/out/interrupt.js`);
const r=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact'}),d=new RuntimeDiagnostics();
let session;
if(process.env.MEMORY)global.gc?.();
const before=process.memoryUsage();
try{if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start');}
 const t=performance.now();let interrupted=false;
 const run=()=>process.env.DIAGNOSTICS?d.run(()=>r.execute(source)):r.execute(source);
 if(process.env.BUDGET_MS){try{withInterrupt({length:1,load:()=>0,store:()=>{},wait:()=>{},exchange:()=>Number(performance.now()-t>=Number(process.env.BUDGET_MS))},run);}catch(e){if(!(e instanceof InterruptedError))throw e;interrupted=true;}}else run();
 const ms=performance.now()-t,after=process.memoryUsage();
 if(process.env.MEMORY)global.gc?.();
 const afterGc=process.memoryUsage();
 console.log(JSON.stringify({mode,n,variant,ms,rssMiB:process.resourceUsage().maxRSS/1024,interrupted,answer:interrupted?undefined:String(r.variables.get('Answer')),...(process.env.MEMORY?{memory:{before,after,afterGc}}:{}),...(process.env.DIAGNOSTICS?{diagnostics:d}:{})}));
 if(session){const {profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}
}finally{session?.disconnect();r.dispose()}
