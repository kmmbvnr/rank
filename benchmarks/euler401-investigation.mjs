import {readFileSync,writeFileSync} from 'node:fs';
import {Interpreter,RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
import {Session} from 'node:inspector/promises';
const [file='demos/euler/401_sumsquares.ra',limit='1000000000000000',mode='compiled']=process.argv.slice(2);
let s;if(process.env.PROFILE){s=new Session();s.connect();await s.post('Profiler.enable');await s.post('Profiler.start');}
const r=new Interpreter(()=>{},{compilation:mode!=='reference',args:[`--limit=${limit}`]});const d=new RuntimeDiagnostics();const t=performance.now();
d.run(()=>r.execute(readFileSync(file,'utf8')));
console.log(JSON.stringify({file,limit,mode,ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024,answer:String((r.variables.get('Answer') ?? r.lastResult)),diagnostics:d}));
if(s){const {profile}=await s.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));s.disconnect();}r.dispose();
