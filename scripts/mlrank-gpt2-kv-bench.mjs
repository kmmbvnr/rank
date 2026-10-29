import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Interpreter,createRamClient} from '../packages/interpreter/out/index.js';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const directory=resolve(process.argv[2]??'/tmp/rank-gpt2-forward');
const programs=Object.fromEntries(['baseline','kv'].map(mode=>[mode,readFileSync(new URL('../demos/mlrank/gpt2-generate'+(mode==='kv'?'-kv':'')+'.ra',import.meta.url),'utf8')]));
const names=['row','attn','mlp','norm','head','tail','qkv','kvwrite','kvattn','tokenmlp','tokennorm','tokenhead','tokentail'];
const modules=Object.fromEntries(names.map(n=>['gpt2'+n+'.ram',readFileSync(new URL('../demos/mlrank/gpt2'+n+'.ram',import.meta.url),'utf8')]));
writeFileSync('/tmp/rank-mlrank/gpt2-kv-bench-fixture.json',JSON.stringify({programs,modules}));
if(process.argv.includes('--fixture'))process.exit();
const runs=[];
const client=createRamClient(sendRamGpu);
try{
 for(const mode of ['baseline','kv','kv','baseline']){
  const tokenEnds=[];let gpuCalls=0,retained=0,readbackBytes=0;
  const gpu=(g,input,files,options)=>{
   const size=g.outputShape.reduce((a,b)=>a*b,1);
   const reply=client.invoke(g,()=>Buffer.from(g.model).toString('base64'),input,size,g.inputs.map(i=>i.shape.reduce((a,b)=>a*b,1)),files,g.reservationBytes,g.inputs.map(i=>i.dtype??'f32'),{...options,inputNames:g.nodes.flatMap((n,i)=>n.kind==='input'?['t'+i]:[]),outputName:'t'+g.output});
   gpuCalls++;if(reply.state)retained++;else readbackBytes+=size*4;
   if(g.outputShape[1]===81)tokenEnds.push(performance.now());
   return reply.state??reply.output;
  };
  gpu.control=request=>client.stateControl(request);
  const runtime=new Interpreter(undefined,{io:nodeIo,loadModule:n=>({id:n,source:modules[n]}),ramGpu:gpu});
  try{
   const source=programs[mode].replaceAll('models/gpt2-tokenizer.json',join(directory,'tokenizer.json')).replaceAll('models/gpt2-forward.safetensors',join(directory,'gpt2-forward.safetensors'));
   const started=performance.now();
   assert.equal(runtime.execute(source),"Hello, I'm");
   const totalMs=performance.now()-started;
   assert.equal(tokenEnds.length,3);
   const status=sendRamGpu({action:'releaseState',stateId:'nonexistent'});assert.equal(status.residentStates,0);
   runs.push({mode,totalMs,firstTokenMs:tokenEnds[0]-started,decodeMs:tokenEnds.slice(1).map((t,i)=>t-tokenEnds[i]),gpuCalls,retainedOutputs:retained,readbackBytes});
  }finally{runtime.dispose();}
 }
 console.log(JSON.stringify({order:'baseline,kv,kv,baseline',includes:'Full program including model compilation, file verification, tokenization and GPU work; decode intervals exclude initial setup',runs},null,2));
}finally{client.release();closeRamGpu();}
