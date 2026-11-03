import{readFileSync,writeFileSync}from'node:fs';
import{Session}from'node:inspector/promises';
import assert from 'node:assert/strict';
const{Interpreter,RuntimeDiagnostics}=await import(process.env.RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const[limit='200000',mode='compiled',file='demos/euler/355_coprime.ra']=process.argv.slice(2);
const kernels=[],phases=[];let last=performance.now();
const r=new Interpreter(t=>{phases.push({text:t,ms:performance.now()-last});last=performance.now()},{compilation:mode!=='reference',args:[`--limit=${limit}`],onIntegerLoopCompiled:s=>kernels.push(s)});
const d=new RuntimeDiagnostics();let session;
try{if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start');}
const start=performance.now();let src=readFileSync(file,'utf8');if(process.env.PHASES)src=src.replace('Root = Limit isqrt','"base" print\nRoot = Limit isqrt').replace('W = array shape','"allocate" print\nW = array shape').replace('Answer = Base','"weights" print\nAnswer = Base');
if(process.env.DIAG)d.run(()=>r.execute(src));else r.execute(src);
const expected={'10':30n,'30':193n,'100':1356n,'200000':1726545007n}[limit];if(expected!==undefined)assert.equal(r.variables.get('Answer'),expected);
console.log(JSON.stringify({limit,mode,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(r.variables.get('Answer')),S:String(r.variables.get('S')),R:String(r.variables.get('R')),phases,...(process.env.DIAG?{diagnostics:d,kernels:kernels.length}:{})}));if(process.env.KERNELS)writeFileSync(process.env.KERNELS,kernels.join('\n\n'));if(session){const{profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}
}finally{r.dispose();session?.disconnect();}
