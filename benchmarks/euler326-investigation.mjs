import {sourceFor} from './experiments/euler326-variants.mjs';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Session} from 'node:inspector/promises';
const root=process.env.RANK_ROOT||fileURLToPath(new URL('..',import.meta.url));
const {Interpreter,RuntimeDiagnostics}=await import(`${root}/packages/interpreter/out/index.js`);
const [mode='compiled',m='1000',n=String(10n**12n),variant='original']=process.argv.slice(2);
if(!['compiled','reference','exact'].includes(mode)||!/^\d+$/.test(m)||!/^\d+$/.test(n))throw Error('mode m n variant');
let source=sourceFor(variant).replace('1000000000000 pairs 1000000',`${n} pairs ${m}`);
const d=new RuntimeDiagnostics(),r=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact'});
let session;
try{
 if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start');}
 const t=performance.now();if(process.env.DIAGNOSTICS)d.run(()=>r.execute(source));else r.execute(source);
 console.log(JSON.stringify({mode,m,n,variant,ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(r.variables.get('Answer')),...(process.env.DIAGNOSTICS?{diagnostics:d}:{} )}));
 if(session){const {profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}
}finally{session?.disconnect();r.dispose()}
