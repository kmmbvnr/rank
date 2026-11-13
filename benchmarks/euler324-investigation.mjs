import {sourceFor} from './experiments/euler324-variants.mjs';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Session} from 'node:inspector/promises';
const root=process.env.RANK_ROOT||fileURLToPath(new URL('..',import.meta.url));
const {Interpreter,RuntimeDiagnostics}=await import(`${root}/packages/interpreter/out/index.js`);
const [mode='compiled',digits='100',variant='original']=process.argv.slice(2);
if(!['compiled','reference','exact'].includes(mode)||!/^\d+$/.test(digits))throw Error('mode digits variant');
let source=sourceFor(variant);
source=source.replace('arg Exp integer = 5 * 10 ** 9999',`arg Exp integer = 5 * 10 ** ${Number(digits)-1}`);
const diagnostics=new RuntimeDiagnostics();const sources=[];
const r=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact',...(process.env.SOURCES?{onIntegerLoopCompiled:s=>sources.push(s)}:{})});
let session;
try{
 if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start');}
 const t=performance.now();if(process.env.DIAGNOSTICS)diagnostics.run(()=>r.execute(source));else r.execute(source);
 console.log(JSON.stringify({mode,digits,variant,ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024,answer:String((r.variables.get('Answer') ?? r.lastResult)),...(process.env.DIAGNOSTICS?{diagnostics}:{} )}));
 if(session){const {profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}
 if(process.env.SOURCES)writeFileSync(process.env.SOURCES,JSON.stringify(sources,null,2));
}finally{session?.disconnect();r.dispose()}
