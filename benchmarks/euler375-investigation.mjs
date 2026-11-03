import {readFileSync,writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
import assert from 'node:assert/strict';
const {Interpreter,RuntimeDiagnostics}=await import(new URL(process.env.RUNTIME || '../packages/interpreter/out/index.js', import.meta.url));
const [file='demos/euler/375_subseqmin.ra',mode='compiled',limit='2000000000',period='6308948']=process.argv.slice(2);
let source=readFileSync(file,'utf8');
source=source.replace('Prev =', '"generated" print\nPrev =').replace('Full =','"left" print\nFull =');
const phases=[],d=new RuntimeDiagnostics();let last,answer;
const r=new Interpreter(t=>{let now=performance.now();phases.push([t,now-last]);last=now;answer=t},{compilation:mode!=='reference',args:['--limit',limit,'--period',period]});
let session;if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start');}
let start=performance.now();last=start;
try{if(process.env.DIAG)d.run(()=>r.execute(source));else r.execute(source);if(limit==='2000000000'&&period==='6308948')assert.equal(answer,'7435327983715286168');console.log(JSON.stringify({file,mode,limit,period,answer,ms:performance.now()-start,rss:process.resourceUsage().maxRSS/1024,phases,...(process.env.DIAG?{d}:{})}));if(session){let{profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}}finally{r.dispose();session?.disconnect();}
