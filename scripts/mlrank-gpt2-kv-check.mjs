import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Interpreter,createRamClient} from '../packages/interpreter/out/index.js';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const directory=resolve(process.argv[2]??'/tmp/rank-gpt2-forward');
const source=readFileSync(new URL('../demos/mlrank/gpt2-generate-kv.ra',import.meta.url),'utf8');
const names=['row','qkv','kvwrite','kvattn','tokenmlp','tokennorm','tokenhead','tokentail'];
const modules=Object.fromEntries(names.map(n=>['gpt2'+n+'.ram',readFileSync(new URL('../demos/mlrank/gpt2'+n+'.ram',import.meta.url),'utf8')]));
const reference=JSON.parse(readFileSync(join(directory,'generation-reference.json')));
const fixture={source,modules,reference};
writeFileSync('/tmp/rank-mlrank/gpt2-kv-fixture.json',JSON.stringify(fixture));
if(process.argv.includes('--fixture'))process.exit();
const profiles=[],checks=[],loads=[];
const client=createRamClient(request=>{
 const reply=sendRamGpu({...request,...(request.action==='invoke'?{profile:true}:{})});
 if(request.action==='load')loads.push(reply);
 if(request.action==='invoke'&&!reply.error){const {output,state,...profile}=reply;profiles.push({...profile,retained:!!state});}
 return reply;
});
let step=0,part=0;
const gpu=(g,input,files,options)=>{
 const reply=client.invoke(g,()=>Buffer.from(g.model).toString('base64'),input,g.outputShape.reduce((a,b)=>a*b,1),g.inputs.map(i=>i.shape.reduce((a,b)=>a*b,1)),files,g.reservationBytes,g.inputs.map(i=>i.dtype??'f32'),{...options,inputNames:g.nodes.flatMap((n,i)=>n.kind==='input'?['t'+i]:[]),outputName:'t'+g.output});
 if(g.outputShape[0]===1&&[1024,81].includes(g.outputShape[1])){
  const expected=reference.steps[step].logits.slice(part*1024,part*1024+g.outputShape[1]);
  let maxError=0;reply.output.forEach((v,i)=>{const error=Math.abs(v-expected[i]);maxError=Math.max(maxError,error);assert.ok(Number.isFinite(v)&&error<5e-4+Math.abs(expected[i])*1e-4,`step ${step} part ${part} index ${i}: ${v} != ${expected[i]}`);});
  checks.push({step,part,maxError,values:expected.length});
  if(++part===50){part=0;step++;}
 }
 return reply.state??reply.output;
};
gpu.control=request=>client.stateControl(request);
const runs=[];
try{
 for(const [prompt,maxNew,startStep] of [['Hello',4,0],['Hello,',2,1]]){
  step=startStep;part=0;
  const runtime=new Interpreter(undefined,{io:nodeIo,loadModule:n=>({id:n,source:modules[n]}),ramGpu:gpu});
  const before=profiles.length,started=performance.now();
  try{
   const program=source.replace('Prompt = "Hello"','Prompt = '+JSON.stringify(prompt)).replace('MaxNew = 3','MaxNew = '+maxNew)
    .replaceAll('models/gpt2-tokenizer.json',join(directory,'tokenizer.json')).replaceAll('models/gpt2-forward.safetensors',join(directory,'gpt2-forward.safetensors'));
   assert.equal(runtime.execute(program),reference.text);
   assert.deepEqual(runtime.variables.get('Tokens').items.map(Number),reference.tokens);
   assert.equal(step,3);
   assert.equal(runtime.variables.get('StopReason'),maxNew===4?'context limit':'token limit');
   const status=sendRamGpu({action:'releaseState',stateId:'nonexistent'});
   assert.equal(status.residentStates,0);assert.equal(status.stateBytes,0);
   runs.push({prompt,maxNew,wallMs:performance.now()-started,gpuCalls:profiles.length-before,finalStateBytes:status.stateBytes});
  }finally{runtime.dispose();}
 }
 const boundaries=[];
 for(const [prompt,maxNew,reason] of [['Hello',0,'token limit'],['Hello, world!',3,'context limit'],['<|endoftext|>',3,'eos']]){
  const before=profiles.length;
  const runtime=new Interpreter(undefined,{io:nodeIo,loadModule:n=>({id:n,source:modules[n]}),ramGpu:gpu});
  try{
   const program=source.replace('Prompt = "Hello"','Prompt = '+JSON.stringify(prompt)).replace('MaxNew = 3','MaxNew = '+maxNew)
    .replaceAll('models/gpt2-tokenizer.json',join(directory,'tokenizer.json')).replaceAll('models/gpt2-forward.safetensors',join(directory,'gpt2-forward.safetensors'));
   assert.equal(runtime.execute(program),prompt);
   assert.equal(runtime.variables.get('StopReason'),reason);
   assert.equal(profiles.length,before);
   boundaries.push(reason);
  }finally{runtime.dispose();}
 }
 const invalid=[];
 for(const [prompt,limit,message] of [['',3,'at least one'],['Hello, world! Hello',3,'at most four'],['Hello',-1,'nonnegative'],['Hello','1.5','integer']]){
  const before=profiles.length;
  const runtime=new Interpreter(undefined,{io:nodeIo,loadModule:n=>({id:n,source:modules[n]}),ramGpu:gpu});
  try{
   const program=source.replace('Prompt = "Hello"','Prompt = '+JSON.stringify(prompt)).replace('MaxNew = 3','MaxNew = '+limit)
    .replaceAll('models/gpt2-tokenizer.json',join(directory,'tokenizer.json')).replaceAll('models/gpt2-forward.safetensors',join(directory,'gpt2-forward.safetensors'));
   assert.throws(()=>runtime.execute(program),new RegExp(message));assert.equal(profiles.length,before);invalid.push(message);
  }finally{runtime.dispose();}
 }
 let mockId=0,mockCalls=0;
 const live=new Set();
 const mockGpu=(g,_input,_files,options)=>{
  mockCalls++;
  if(options?.retainOutput){const id='mock-'+(++mockId);live.add(id);return {id,shape:g.outputShape,dtype:'f32'};}
  const values=Array(g.outputShape.reduce((a,b)=>a*b,1)).fill(0);
  if(g.outputShape[1]===81)values[80]=1;
  return values;
 };
 mockGpu.control=request=>{assert.equal(request.action,'releaseState');assert.ok(live.delete(request.stateId));return {};};
 const eos=new Interpreter(undefined,{io:nodeIo,loadModule:n=>({id:n,source:modules[n]}),ramGpu:mockGpu});
 try{
  assert.equal(eos.execute(source.replaceAll('models/gpt2-tokenizer.json',join(directory,'tokenizer.json')).replaceAll('models/gpt2-forward.safetensors',join(directory,'gpt2-forward.safetensors'))),'Hello');
  assert.equal(eos.variables.get('StopReason'),'eos');assert.equal(mockCalls,100);assert.equal(live.size,0);
 }finally{eos.dispose();}
 assert.ok(profiles.filter(p=>p.retained).every(p=>p.outputBytesRead===0));
 console.log(JSON.stringify({text:reference.text,tokens:reference.tokens,runs,boundaries,invalid,generatedEosMockVerified:true,valuesCompared:checks.reduce((n,c)=>n+c.values,0),maxError:Math.max(...checks.map(c=>c.maxError)),retainedOutputs:profiles.filter(p=>p.retained).length,stateInputsReused:profiles.reduce((n,p)=>n+p.stateInputsReused,0),peakStateBytes:Math.max(...profiles.map(p=>p.stateBytes)),loads:loads.length,profiles},null,2));
}finally{client.release();closeRamGpu();}
