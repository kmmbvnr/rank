import {readFileSync,writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
const controls=(process.env.CONTROL||'').split(',');
if(controls.some(Boolean)){
const {registerHooks}=await import('node:module');
if(!registerHooks)throw Error('Feature controls require Node with module.registerHooks');
registerHooks({load(url,context,next){
 const result=next(url,context);if(!url.includes('/out/')||!url.endsWith('.js'))return result;
 let source=String(result.source);
 if(controls.includes('packed')&&url.endsWith('/runtime/packed-booleans.js')){
  const needle='export function gatherPackedBooleans(source, offsets, shape) {';
  if(!source.includes(needle))throw Error('packed control mismatch');
  source=source.replace(needle,needle+' return undefined;');
 }
 if(controls.includes('choose')&&url.endsWith('/jit/integer-loop-expressions.js')){
  const needle='const choice = host.nativeCalls && scalarChooseOperands';
  if(!source.includes(needle))throw Error('choose control mismatch');
  source=source.replace(needle,'const choice = false && scalarChooseOperands');
 }
 if(controls.includes('abs')&&url.endsWith('/operations.js')){
  const start=source.indexOf("{ name: 'abs',");
  if(start<0)throw Error('abs control mismatch');
  const tail=source.slice(start),nextTail=tail.replace(/\{ inputs: \['integer'\], result: 'integer', callbacks: 'none', cost: 'input-dependent' \},\s*/,'');
  if(nextTail===tail)throw Error('abs overload control mismatch');
  source=source.slice(0,start)+nextTail;
 }
 return {...result,source};
}});
}
const {Interpreter,RuntimeDiagnostics}=await import('../packages/interpreter/out/index.js');
const [id='505',size='1000000',mode='compiled',variant='original']=process.argv.slice(2);
const files={501:'eightdivisors',502:'countingcastles',504:'squareinside',505:'bidirectional',507:'shortestlattice',511:'nicesequences',513:'integralmedian'};
let source=readFileSync(new URL(`../demos/euler/${id}_${files[id]}.ra`,import.meta.url),'utf8');
if(variant!=='original') source=readFileSync(new URL(`./experiments/euler${id}-${variant}.ra`,import.meta.url),'utf8');
const args=size==='full'?[]:id==='504'?[`--m=${size}`]:id==='502'?[`--w1=${size}`,`--h1=${size}`,`--w2=${size}`,`--h2=${size}`,`--w3=${size}`,`--h3=${size}`]:id==='511'?[`--k=${size}`]:id==='507'?[`--n=${size}`,'--lc=14']:[`--n=${size}`];
if(process.env.LC){const index=args.findIndex(arg=>arg.startsWith('--lc='));if(index>=0)args[index]='--lc='+process.env.LC;else args.push('--lc='+process.env.LC);}
const r=new Interpreter(()=>{},{args,compilation:mode!=='reference',numberLoopCompilation:mode!=='exact'}),d=new RuntimeDiagnostics();
let session;
try{
 if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start');}
 const start=performance.now(); if(process.env.DIAGNOSTICS)d.run(()=>r.execute(source));else r.execute(source);
 const ms=performance.now()-start,answer=String((r.variables.get('Answer') ?? r.lastResult));
 const expected=({501:{full:'197912312715'},507:{full:'316558047002627270'},513:{full:'2925619196'},505:{1000:'101881',1000000:'12541668533',1000000000:'1551491048361091',1000000000000:'714591308667615832',full:'714591308667615832'},504:{4:'42',100:'694687',full:'694687'},511:{1024:'833781248',4321:'935247012',full:'935247012'},502:{150:'631001246',full:'749485217'}})[id]?.[size];
 if(expected!==undefined && answer!==expected)throw Error(`answer ${answer} != ${expected}`);
 console.log(JSON.stringify({id,size,mode,variant,controls,args,ms,answer,sourceHash:createHash('sha256').update(source).digest('hex'),arch:process.arch,node:process.version,cpu:cpus()[0]?.model,rssMiB:process.resourceUsage().maxRSS/1024,...(process.env.DIAGNOSTICS?{diagnostics:d}:{})}));
 if(session){const {profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}
}finally{session?.disconnect();r.dispose()}
