import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
const runtimeUrl = new URL(process.env.RUNTIME || '../packages/interpreter/out/index.js',import.meta.url);
const {Interpreter,RuntimeDiagnostics} = await import(runtimeUrl);
const [file='demos/euler/378_triangles.ra',limit='1000000',mode='compiled'] = process.argv.slice(2);
let source=readFileSync(file,'utf8');
if(process.env.STAGES) source=source.replaceAll(/rem @stage (\w+)/g,(_,name)=>`"stage:${name}" print`);
const diagnostics=new RuntimeDiagnostics(), stages=[];
let answer,start;
const runtime=new Interpreter(value=>{
 if(String(value).startsWith('stage:'))stages.push({stage:String(value).slice(6),ms:performance.now()-start});
 else answer=String(value).trim();
},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact',args:[`--limit=${limit}`]});
let session;
if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start');}
try{
 start=performance.now();
 if(process.env.DIAG)diagnostics.run(()=>runtime.execute(source));else runtime.execute(source);
 const ms=performance.now()-start;
 const expected={0:'0',1:'0',20:'14',100:'5772',1000:'11174776',1000000:'17911338911265382',60000000:'147534623725724718'}[limit];
 if(expected!==undefined)assert.equal(answer,expected);
 let storage;
 if(process.env.MEMORY){
  const {ownedStorage}=await import(new URL('array-storage-state.js',runtimeUrl));
  storage={};
  for(const[name,value]of runtime.variables){
   const data=value&&typeof value==='object'?ownedStorage.get(value):undefined;
   if(data)storage[name]={length:data.items.length,type:data.typed?.constructor.name,bytes:data.typed?.byteLength};
  }
 }
 console.log(JSON.stringify({file,limit,mode,answer,ms,rssMiB:process.resourceUsage().maxRSS/1024,stages,storage,...(process.env.DIAG?{diagnostics}:{})}));
 if(session){const{profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}
}finally{runtime.dispose();session?.disconnect();}
