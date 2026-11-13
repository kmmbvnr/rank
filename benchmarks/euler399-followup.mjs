import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Session} from 'node:inspector/promises';
import {Interpreter,RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [p='10000',mode='compiled',file='demos/euler/399_squarefree.ra',stage='moduli']=process.argv.slice(2);
let source=readFileSync(file,'utf8');
if(stage==='moduli')source=source.slice(0,source.indexOf('rem Find the Count-th'))+'\n'+source.slice(source.indexOf('rem Fast doubling'));
const r=new Interpreter(()=>{},{compilation:mode!=='reference',args:[`--prime-limit=${p}`]});
const d=new RuntimeDiagnostics();let session;
if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start');}
const start=performance.now();
try{if(process.env.DIAG)d.run(()=>r.execute(source));else r.execute(source);
console.log(JSON.stringify({p,mode,file,stage,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,mods:r.variables.get('Mods')?.shape,modsHash:createHash('sha256').update(r.variables.get('Mods').items.map(String).join(',')).digest('hex'),index:String(r.variables.get('Index')??''),answer:String((r.variables.get('Answer') ?? r.lastResult)??''),...(process.env.DIAG?{diagnostics:d}:{})}));
if(session){const {profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}}
finally{session?.disconnect();r.dispose();}
