import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
import {Interpreter,RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [k='1000', mode='compiled',file='demos/euler/397_parabola.ra',x='1000000000']=process.argv.slice(2);
const source=readFileSync(file,'utf8');
const r=new Interpreter(()=>{},{onIntegerLoopCompiled:process.env.CODE?(s)=>writeFileSync(process.env.CODE,s):undefined,compilation:mode!=='reference',args:[`--k=${k}`,`--x=${x}`]});
const d=new RuntimeDiagnostics();
let s;
if(process.env.PROFILE){s=new Session();s.connect();await s.post('Profiler.enable');await s.post('Profiler.start');}
const start=performance.now();
try{if(process.env.DIAG)d.run(()=>r.execute(source));else r.execute(source);
const checks=new Map([['1000',63237130793050n],['10000',1008745304821002n],['100000',13388504309158360n],['1000000',141630459461893728n]]);
if(x==='1000000000'&&checks.has(k))assert.equal(r.variables.get('Answer'),checks.get(k));
console.log(JSON.stringify({sink:process.env.SINK||false,k,mode,file,x,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(r.variables.get('Answer')),...(process.env.DIAG?{diagnostics:d}:{})}));
if(s){const {profile}=await s.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}}
finally{s?.disconnect();r.dispose();}
