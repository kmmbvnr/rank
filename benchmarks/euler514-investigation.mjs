import {readFileSync, writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
import {Interpreter, RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [size='10', mode='compiled', variant='original'] = process.argv.slice(2);
const path = variant === 'lines' ? 'demos/euler/514_geoboard.ra' : `benchmarks/experiments/euler514-${variant}.ra`;
const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
const runtime=new Interpreter(()=>{}, {args:[`--n=${size}`],compilation:mode!=='reference'});
const diagnostics=new RuntimeDiagnostics();
let session;
try {
 if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start');}
 const start=performance.now();
 if(process.env.DIAGNOSTICS)diagnostics.run(()=>runtime.execute(source));else runtime.execute(source);
 const answer=String(runtime.variables.get('Answer'));
 const expected={0:'0',1:'0.1875',2:'0.94335',10:'55.03013',100:'8986.86698'}[size];
 if(expected!==undefined&&answer!==expected)throw Error(`answer ${answer} != ${expected}`);
 console.log(JSON.stringify({size,mode,variant,answer,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,node:process.version,arch:process.arch,cpu:cpus()[0]?.model,sourceHash:createHash('sha256').update(source).digest('hex'),...(process.env.DIAGNOSTICS?{diagnostics}:{})}));
 if(session){const {profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}
} finally {session?.disconnect();runtime.dispose();}
