import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Interpreter,createRamClient} from '../packages/interpreter/out/index.js';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const directory=resolve(process.argv[2]??'/tmp/rank-gpt2-forward');
const retained=process.argv.includes('--retained');
const modes=retained?['batched','retained']:['sequential','batched'];
const short=process.argv.includes('--short');
const programs=Object.fromEntries(modes.map(mode=>[mode,readFileSync(new URL('../demos/mlrank/gpt2-generate-'+(mode==='retained'?'retained16':mode==='batched'?'prefill16':'kv16')+'.ra',import.meta.url),'utf8').replace(/^Prompt = .*$/m,'Prompt = '+JSON.stringify(short?'Hello':'Hello, world! My name is')).replace(/^MaxNew = .*$/m,'MaxNew = '+(short?1:2))]));
const names=['row','qkv','kvwrite16','kvattn16','tokenmlp','tokennorm','tokenhead','tokentail','prefillqkv16','prefillcache16','prefillattn16','prefillmlp16'];
if(retained)names.push('prefilllast16');
const modules=Object.fromEntries(names.map(n=>['gpt2'+n+'.ram',readFileSync(new URL('../demos/mlrank/gpt2'+n+'.ram',import.meta.url),'utf8')]));
const expected=JSON.parse(readFileSync(join(directory,'context-reference.json'))).cases.find(c=>c.name===(short?'masked':'prefill')).text;
const order=[modes[0],modes[1],modes[1],modes[0]];
mkdirSync('/tmp/rank-mlrank',{recursive:true});
writeFileSync('/tmp/rank-mlrank/gpt2-'+(retained?'retained':'prefill')+(short?'-short':'')+'-bench-fixture.json',JSON.stringify({programs,modules,expected,order,profileModes:modes}));
if(process.argv.includes('--fixture'))process.exit();
const runs=[];
let profile=false,fileBytesRead=0;
const client=createRamClient(request=>{const reply=sendRamGpu({...request,...(profile?{profile:true}:{})});fileBytesRead+=reply.fileBytesRead??0;return reply;});
try{
 for(const [index,mode] of [...order,...modes].entries()){
  profile=index>=order.length;fileBytesRead=0;
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
   assert.equal(runtime.execute(source),expected);
   const totalMs=performance.now()-started;
   assert.equal(tokenEnds.length,short?1:2);
   const status=sendRamGpu({action:'releaseState',stateId:'nonexistent'});assert.equal(status.residentStates,0);
   runs.push({mode,profile,...(profile?{fileBytesRead}:{}),totalMs,firstTokenMs:tokenEnds[0]-started,decodeMs:tokenEnds.slice(1).map((t,i)=>t-tokenEnds[i]),gpuCalls,retainedOutputs:retained,readbackBytes});
  }finally{runtime.dispose();}
 }
 console.log(JSON.stringify({order:order.join(','),includes:'ABBA unprofiled full-program timing; first token includes prefill/setup. Two separate profiled runs measure native file bytes.',runs},null,2));
}finally{client.release();closeRamGpu();}
