import {readFileSync,writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
import {cpus} from 'node:os';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
const control=process.env.CONTROL??'';
if(control&&!['no-batch','no-integer-kernel','no-both'].includes(control))throw Error('unknown control');
if(control)registerHooks({load(url,context,next){
 const loaded=next(url,context);let pattern;
 if(control!=='no-integer-kernel'&&url.endsWith('/runtime/sorted-search.js'))pattern='export function sortedIndexBatch(source, targets, upper) {';
 if(control!=='no-batch'&&url.endsWith('/jit/integer-array-kernel.js'))pattern='export function mapStoredIntegers(left, right, name) {';
 if(!pattern)return loaded;
 const text=String(loaded.source);if(!text.includes(pattern))throw Error(`control target missing: ${url}`);
 return {...loaded,source:text.replace(pattern,pattern+' return undefined;')};
}});
const {Interpreter,RuntimeDiagnostics}=await import('../packages/interpreter/out/index.js');
const [limit='1000000000000',mode='compiled',variant='final']=process.argv.slice(2);
const path=variant==='final'?'demos/euler/516_5smoothtotients.ra':`benchmarks/experiments/euler516-${variant}.ra`;
const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
const r=new Interpreter(()=>{}, {args:[`--l=${limit}`],compilation:mode!=='reference'});
let session;
try {
 if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start');}
 const d=new RuntimeDiagnostics(),t=performance.now();
 if(process.env.DIAGNOSTICS)d.run(()=>r.execute(source));else r.execute(source);
 const answer=String((r.variables.get('Answer') ?? r.lastResult));
 const expected={'100':'3728','1000000000000':'939087315'}[limit];
 if(expected!==undefined&&answer!==expected)throw Error(`answer ${answer} != ${expected}`);
 const values={};for(const name of ['Answer','H','Pr','Q']){const v=r.variables.get(name);values[name]=name==='Answer'?String(v):String(v?.length??v?.shape??'');}
 console.log(JSON.stringify({limit,mode,variant,control,...values,sourceHash:createHash('sha256').update(source).digest('hex'),arch:process.arch,ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024,node:process.version,cpu:cpus()[0].model,...(process.env.DIAGNOSTICS?{diagnostics:d}:{})}));
 if(session){const {profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}
}finally{session?.disconnect();r.dispose();}
