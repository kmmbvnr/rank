import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {Session} from 'node:inspector/promises';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const [limit='10000000',mode='compiled',file='demos/euler/354_honeycomb.ra']=process.argv.slice(2);
const kernels=[],phases=[];let last=performance.now();
const runtime=new Interpreter(text=>{if(process.env.PHASES){const now=performance.now();phases.push({label:text.trim(),ms:now-last});last=now;}}, {compilation:mode!=='reference',args:[`--limit=${limit}`],...(process.env.DIAG?{onIntegerLoopCompiled:s=>kernels.push(s)}:{})});
const diagnostics=new RuntimeDiagnostics();
let session;
try{
 if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start');}
 const start=performance.now();
 last=performance.now();
 let source=readFileSync(file,'utf8');
 if(process.env.PHASES)source=source.replace('Good = Good scan +','Good = Good scan +\n"sieve" print').replace('rem Exponents 14,4.','"24,2" print\nrem Exponents 14,4.').replace('rem Exponents 4,4,2 by quotient blocks.','"14,4" print\nrem Exponents 4,4,2 by quotient blocks.');
 const run=()=>runtime.execute(source);
 if(process.env.DIAG)diagnostics.run(run);else run();
 const expected={'0':'0','1000000':'18','10000000':'597','500000000000':'58065134'}[limit];
 if(expected!==undefined)assert.equal(String(runtime.variables.get('Answer')),expected);
 console.log(JSON.stringify({limit,mode,file,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(runtime.variables.get('Answer')),phases,node:process.version,arch:process.arch,...(process.env.DIAG?{diagnostics,kernels:kernels.length}:{})}));
 if(process.env.KERNELS)writeFileSync(process.env.KERNELS,kernels.join('\n\n'));
 if(session){const {profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}
}finally{session?.disconnect();runtime.dispose();}
