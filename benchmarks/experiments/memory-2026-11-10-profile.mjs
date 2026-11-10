// Usage: node memory-2026-11-10-profile.mjs ROOT PROGRAM [ARGS...]
// PROFILE_SOURCE selects additional statements inside functions/loops.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [root,file,...args]=process.argv.slice(2);
const load=p=>import(pathToFileURL(resolve(root,'packages/interpreter/out',p)));
const {Interpreter,parse,RuntimeDiagnostics}=await load('index.js');
const {mapResult}=await load('execution.js');
const {nodeIo}=await import(pathToFileURL(resolve(root,'packages/cli/out/node-io.js')));
const {ownedStorage}=await load('array-storage-state.js');
const source=readFileSync(resolve(root,file),'utf8'), program=parse(source);
const runtime=new Interpreter(x=>console.error('ANSWER',String(x)),{args,io:nodeIo});
const diagnostics=new RuntimeDiagnostics();
let previous=performance.now();
function report(statement){
 const now=performance.now(), memory=process.memoryUsage();
 const arrays=[...runtime.variables].flatMap(([name,value])=>{
  if(value?.kind!=='array')return [];
  const state=ownedStorage.get(value), count=value.shape.reduce((a,b)=>a*b,1);
  if(count<10000)return [];
  return [{name,shape:value.shape,type:state?.typed?.constructor.name??(state?.booleans?'bits':state?'boxed':'derived'),bytes:state?.typed?.byteLength??state?.booleans?.words.byteLength,bufferBytes:state?.typed?.buffer.byteLength}];
 });
 console.log(JSON.stringify({line:statement.$cstNode?.range.start.line+1,source:statement.$cstNode?.text.split('\n')[0],ms:now-previous,memory,arrays}));previous=now;
}
const selected=process.env.PROFILE_SOURCE ? new RegExp(process.env.PROFILE_SOURCE) : undefined;
const original=runtime.blocks.preparedStatement;
runtime.blocks.preparedStatement=function(statements,index){
 const p=original.call(this,statements,index);
 if(statements!==program.statements && !selected?.test(statements[index]?.$cstNode?.text ?? ''))return p;
 const q={...p};
 if(p.stream)q.stream=(...args)=>mapResult(p.stream(...args),r=>{report(statements[index]);return r;});
 if(p.run)q.run=(...args)=>{const r=p.run(...args);report(statements[index]);return r;};
 if(p.tensor)q.tensor={...p.tensor,run:(...args)=>{const r=p.tensor.run(...args);if(r!==undefined)report(statements[index]);return r;}};
 return q;
};
try{diagnostics.run(()=>runtime.executeProgram(program,args));console.error(JSON.stringify({peakRssMiB:process.resourceUsage().maxRSS/1024,costs:diagnostics.costs}));}finally{runtime.dispose();}
