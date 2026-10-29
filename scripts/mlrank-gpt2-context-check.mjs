import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Interpreter,createRamClient} from '../packages/interpreter/out/index.js';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const directory=resolve(process.argv[2]??'/tmp/rank-gpt2-forward');
const retained=process.argv.includes('--retained');
const batched=retained||process.argv.includes('--batched');
const source=readFileSync(new URL('../demos/mlrank/gpt2-generate-'+(retained?'retained16':batched?'prefill16':'kv16')+'.ra',import.meta.url),'utf8');
const names=['row','qkv','kvwrite16','kvattn16','tokenmlp','tokennorm','tokenhead','tokentail'];
if(batched)names.push('prefillqkv16','prefillcache16','prefillattn16','prefillmlp16');
if(retained)names.push('prefilllast16');
const modules=Object.fromEntries(names.map(n=>['gpt2'+n+'.ram',readFileSync(new URL('../demos/mlrank/gpt2'+n+'.ram',import.meta.url),'utf8')]));
const reference=JSON.parse(readFileSync(join(directory,'context-reference.json')));
if(batched)reference.cases.push({...reference.cases.find(c=>c.name==='prefill'),name:'prefill-padding',poison:true});
const failures=retained?[
 {name:'prefill-attention',prompt:'Hello, world! My name is',after:'Projection gpufree'},
 {name:'prefill-mlp',prompt:'Hello, world! My name is',after:'X = H prefillfeedforward G2 B2 UpW UpB DownW DownB'},
 {name:'selected-row',prompt:'Hello, world! My name is',after:'Selected = X lastrow Selector'},
 {name:'normalized-hidden',prompt:'Hello, world! My name is',after:'Hidden = X normalize G B'},
 {name:'decode-attention',prompt:'Hello',after:'H = X attention Projection NewCache Mask O OutBias'},
]:[];
mkdirSync('/tmp/rank-mlrank',{recursive:true});
writeFileSync('/tmp/rank-mlrank/gpt2-'+(retained?'retained':batched?'prefill':'context')+'-fixture.json',JSON.stringify({source,modules,reference,batched,retained,failures}));
if(process.argv.includes('--fixture'))process.exit();
let current,step,part,calls=0,valuesCompared=0,maxError=0,peakStateBytes=0;
const client=createRamClient(request=>{
 const reply=sendRamGpu(request);peakStateBytes=Math.max(peakStateBytes,reply.stateBytes??0);return reply;
});
const gpu=(g,input,files,options)=>{
 calls++;
 const reply=client.invoke(g,()=>Buffer.from(g.model).toString('base64'),input,g.outputShape.reduce((a,b)=>a*b,1),g.inputs.map(i=>i.shape.reduce((a,b)=>a*b,1)),files,g.reservationBytes,g.inputs.map(i=>i.dtype??'f32'),{...options,inputNames:g.nodes.flatMap((n,i)=>n.kind==='input'?['t'+i]:[]),outputName:'t'+g.output});
 if(g.outputShape[0]===1&&[1024,81].includes(g.outputShape[1])){
  const expected=current.steps[step].logits.slice(part*1024,part*1024+g.outputShape[1]);
  assert.equal(reply.output.length,expected.length);
  reply.output.forEach((value,i)=>{const e=Math.abs(value-expected[i]);maxError=Math.max(maxError,e);assert.ok(Number.isFinite(value)&&e<=5e-4+Math.abs(expected[i])*1e-4,`${current.name}: step ${step}, part ${part}, cell ${i}: ${value} != ${expected[i]}`);});
  valuesCompared+=expected.length;
  if(++part===50){part=0;step++;}
 }
 return reply.state??reply.output;
};
gpu.control=request=>client.stateControl(request);
const program=c=>source.replace(/^Prompt = .*$/m,'Prompt = '+JSON.stringify(c.prompt)).replace(/^MaxNew = .*$/m,'MaxNew = '+c.maxNew)
 .replace('Empty = array shape ContextLimit 1536 fill 0.0',c.poison?'Empty = ((1 to (ContextLimit * 1536)) * 0.00001) reshape ContextLimit 1536':'Empty = array shape ContextLimit 1536 fill 0.0')
 .replace('X = array shape ContextLimit 768 fill 0.0',c.poison?'X = ((1 to (ContextLimit * 768)) * 0.00001) reshape ContextLimit 768':'X = array shape ContextLimit 768 fill 0.0')
 .replace('Rows = array shape ContextLimit 768 fill 0.0',c.poison?'Rows = ((1 to (ContextLimit * 768)) * 0.00001) reshape ContextLimit 768':'Rows = array shape ContextLimit 768 fill 0.0')
 .replaceAll('models/gpt2-tokenizer.json',join(directory,'tokenizer.json')).replaceAll('models/gpt2-forward.safetensors',join(directory,'gpt2-forward.safetensors'));
const create=()=>new Interpreter(undefined,{io:nodeIo,loadModule:n=>({id:n,source:modules[n]}),ramGpu:gpu});
const runs=[],boundaries=[],invalid=[],failedStages=[];
try{
 for(const c of reference.cases){
  current=c;step=0;part=0;const runtime=create(),before=calls,started=performance.now();
  try{
   assert.equal(runtime.execute(program(c)),c.text);
   assert.deepEqual(runtime.variables.get('Tokens').items.map(Number),c.tokens);
   assert.equal(runtime.variables.get('StopReason'),c.reason);assert.equal(step,c.steps.length);assert.equal(part,0);
   const status=sendRamGpu({action:'releaseState',stateId:'nonexistent'});assert.equal(status.stateBytes,0);assert.equal(status.residentStates,0);
   runs.push({name:c.name,promptTokens:c.promptTokens.length,generated:c.tokens.length-c.promptTokens.length,text:c.text,reason:c.reason,wallMs:performance.now()-started,gpuCalls:calls-before,finalStateBytes:0});
  }finally{runtime.dispose();}
 }
 for(const c of reference.boundaries){
  const runtime=create(),before=calls;
  try{assert.equal(runtime.execute(program(c)),c.prompt);assert.equal(runtime.variables.get('StopReason'),c.reason);assert.equal(calls,before);boundaries.push(c.reason);}finally{runtime.dispose();}
 }
 for(const c of reference.invalid){
  const runtime=create(),before=calls;
  try{assert.throws(()=>runtime.execute(program(c)),new RegExp(c.message));assert.equal(calls,before);invalid.push(c.message);}finally{runtime.dispose();}
 }
 for(const failure of failures){
  const runtime=create();
  try{
   const source=program({...failure,maxNew:1}).replace(failure.after,failure.after+'\n.DomainError "injected activation failure" raise');
   assert.throws(()=>runtime.execute(source),/injected activation failure/);
   const status=sendRamGpu({action:'releaseState',stateId:'nonexistent'});
   assert.equal(status.residentStates,0);assert.equal(status.stateBytes,0);
   failedStages.push(failure.name);
  }finally{runtime.dispose();}
 }
 console.log(JSON.stringify({context:16,batched,retained,runs,boundaries,invalid,failedStages,valuesCompared,maxError,peakStateBytes},null,2));
}finally{client.release();closeRamGpu();}
