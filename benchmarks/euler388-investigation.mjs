import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
import {Interpreter, RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [file='demos/euler/388_lines.ra',n='10000000000',cut='4641589',mode='compiled']=process.argv.slice(2);
const runtime=new Interpreter(()=>{}, {compilation:mode!=='reference',args:[`--n=${n}`,`--cut=${cut}`]});
const diagnostics=new RuntimeDiagnostics();
let session;
try {
 if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start');}
 const start=performance.now();
 const source=readFileSync(file,'utf8');
 if(process.env.DIAG) diagnostics.run(()=>runtime.execute(source)); else runtime.execute(source);
 const ms=performance.now()-start;
 const expected={0:0n,1:7n,40:56335n,1000000:831909254469114121n,10000000000:831907372771451255456805129931n}[n];
 if(expected!==undefined) assert.equal((runtime.variables.get('Answer') ?? runtime.lastResult),expected);
 if(session){const {profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}
 console.log(JSON.stringify({file,n,cut,mode,answer:String((runtime.variables.get('Answer') ?? runtime.lastResult)),token:runtime.variables.get('Token'),ms,rssMiB:process.resourceUsage().maxRSS/1024,...(process.env.DIAG?{diagnostics}:{})}));
}finally{session?.disconnect();runtime.dispose();}
