import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
import {Interpreter,RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [limit='1000',mode='compiled',file='demos/euler/391_hopping.ra']=process.argv.slice(2);
const r=new Interpreter(()=>{},{compilation:mode!=='reference',args:[`--limit=${limit}`]});
const d=new RuntimeDiagnostics();let s;
try{if(process.env.PROFILE){s=new Session();s.connect();await s.post('Profiler.enable');await s.post('Profiler.start');}
const start=performance.now();if(process.env.DIAG)d.run(()=>r.execute(readFileSync(file,'utf8')));else r.execute(readFileSync(file,'utf8'));
const ms=performance.now()-start;
const expected={0:0n,2:8n,7:90n,20:8150n,100:5642811n,300:460586640n,1000:61029882288n}[limit];
if(expected!==undefined)assert.equal(r.variables.get('Answer'),expected);
if(s){const {profile}=await s.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}
console.log(JSON.stringify({limit,mode,file,ms,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(r.variables.get('Answer')),...(process.env.DIAG?{diagnostics:d}:{})}));}finally{s?.disconnect();r.dispose();}
