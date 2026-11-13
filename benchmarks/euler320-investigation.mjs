import {sourceFor} from './experiments/euler320-variants.mjs';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Session} from 'node:inspector/promises';
const root=process.env.RANK_ROOT||fileURLToPath(new URL('..',import.meta.url));
const {Interpreter,RuntimeDiagnostics}=await import(`${root}/packages/interpreter/out/index.js`);
const [mode='compiled',upper='1000',variant='original']=process.argv.slice(2);
if(!['compiled','reference','exact'].includes(mode)||!/^\d+$/.test(upper))throw Error('mode upper variant');
let source=sourceFor(variant);
const diagnostics=new RuntimeDiagnostics(),sources=[];
const runtime=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact',args:[`--upper=${upper}`],...(process.env.SOURCES?{onIntegerLoopCompiled:s=>sources.push(s)}:{})});
let session;
try{
 if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start');}
 const t=performance.now();
 if(process.env.DIAGNOSTICS)diagnostics.run(()=>runtime.execute(source));else runtime.execute(source);
 console.log(JSON.stringify({mode,upper,variant,ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024,answer:String((runtime.variables.get('Answer') ?? runtime.lastResult)),...(process.env.DIAGNOSTICS?{diagnostics}:{} )}));
 if(session){const {profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}
 if(process.env.SOURCES)writeFileSync(process.env.SOURCES,JSON.stringify(sources,null,2));
}finally{session?.disconnect();runtime.dispose()}
