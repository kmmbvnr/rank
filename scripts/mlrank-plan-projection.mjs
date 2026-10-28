// Plan one explicit X @ W.T projection; generated Rank source remains reviewable.
import {existsSync,mkdirSync,mkdtempSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {resolve,dirname,basename,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {safetensor} from '../packages/interpreter/out/safetensors.js';
import {fileTensorInput} from '../packages/interpreter/out/file-tensor.js';
import {compileRam} from '../packages/interpreter/out/index.js';

export function planProjection(input,name,output,{chunkBytes=4*1024*1024}={}){
 if(!Number.isSafeInteger(chunkBytes)||chunkBytes<4||chunkBytes>16*1024*1024)throw Error('Chunk budget must be an integer from 4 bytes through 16 MiB');
 const path=resolve(input),destination=resolve(output);
 if(existsSync(destination))throw Error('Output directory already exists');
 const handle=nodeIo.open(path,'read');let temporary;
 try{
  const revision=handle.revision(),d=fileTensorInput(safetensor({kind:'file',closed:false,handle},name));
  if(!d||d.dtype!=='F32'||d.shape.length!==2||d.shape.some(n=>n<1))throw Error('Projection requires a nonempty F32 matrix [outputs, inputs]; prepare the weight first');
  const [outputs,inputs]=d.shape;
  if(outputs>1048576)throw Error('Projection host output exceeds 1048576 elements');
  // Transpose is a computed tensor, so its existing 1M-cell limit also applies.
  const rows=Math.min(outputs,Math.floor(chunkBytes/(inputs*4)),Math.floor(1048576/inputs));
  if(rows<1)throw Error('One weight row exceeds the chunk budget or computed-tensor limit');
  const full=Math.floor(outputs/rows),tail=outputs%rows;
  const modules={},reservations={};
  const module=(name,n)=>{
   const source=`use ml\narg X .f32 shape 1 ${inputs}\narg W .f32 shape ${n} ${inputs}\nreturn X matmul (W transpose)\n`;
   const graph=compileRam(source,name).graph;
   modules[name]=source;reservations[name]=graph.reservationBytes;
  };
  module('projectpart.ram',rows);if(tail)module('projecttail.ram',tail);
  const sha256=handle.sha256();if(handle.revision()!==revision)throw Error('Weight file changed during planning');
  const lines=['use io',...Object.keys(modules).map(n=>`use ${JSON.stringify(n)}`),`F = ${JSON.stringify(path)} open`,`F verify "${sha256}"`,`W' = F tensor ${JSON.stringify(name)}`,`X = array shape 1 ${inputs} fill 0.5`,`Result = array shape 1 ${outputs} fill 0.0`,
   `for Start in 0 till ${full*rows} by ${rows}`,`Part' = W (Start till (Start + ${rows})) #`,'Y = X projectpart Part',`Result # (Start till (Start + ${rows})) = Y`,'end'];
  if(tail)lines.push(`Part' = W (${full*rows} till ${outputs}) #`,'Y = X projecttail Part',`Result # (${full*rows} till ${outputs}) = Y`);
  lines.push('F close','Result');const source=lines.join('\n')+'\n';
  const plan={version:1,operation:'X @ W.T',source:{path,tensor:name,sha256,shape:d.shape},inputShape:[1,inputs],outputShape:[1,outputs],chunkBudgetBytes:chunkBytes,rowsPerPart:rows,fullParts:full,tailRows:tail,gpuCalls:full+(tail?1:0),maxWeightBytes:rows*inputs*4,reservations};
  mkdirSync(dirname(destination),{recursive:true});temporary=mkdtempSync(join(dirname(destination),'.'+basename(destination)+'-'));
  writeFileSync(join(temporary,'main.ra'),source);for(const [n,s]of Object.entries(modules))writeFileSync(join(temporary,n),s);
  writeFileSync(join(temporary,'plan.json'),JSON.stringify(plan,null,2)+'\n');renameSync(temporary,destination);temporary=undefined;
  return {...plan,directory:destination};
 }finally{if(temporary)rmSync(temporary,{recursive:true,force:true});handle.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [input,name,output,budget,...extra]=process.argv.slice(2);
 if(!input||!name||!output||extra.length)throw Error('Usage: node scripts/mlrank-plan-projection.mjs WEIGHTS.safetensors TENSOR NEW_DIRECTORY [CHUNK_BYTES]');
 console.log(JSON.stringify(planProjection(input,name,output,budget===undefined?{}:{chunkBytes:Number(budget)}),null,2));
}
