import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {Interpreter,createRamClient} from '../packages/interpreter/out/index.js';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const directory=resolve(process.argv[2]);
const reference=JSON.parse(readFileSync(join(directory,'generation-reference.json')));
const tokenizerReference=JSON.parse(readFileSync(join(directory,'tokenizer-reference.json')));
const config=readFileSync(join(directory,'tokenizer.json'),'utf8');
const fixture=JSON.parse(readFileSync(join(directory,'fixture.json')));
const source=readFileSync(new URL('../demos/mlrank/gpt2-generate.ra',import.meta.url),'utf8');
const modules=Object.fromEntries(['gpt2row','gpt2attn','gpt2mlp','gpt2norm','gpt2head','gpt2tail'].map(n=>[n+'.ram',readFileSync(new URL('../demos/mlrank/'+n+'.ram',import.meta.url),'utf8')]));
const local=s=>s.replaceAll('models/gpt2-tokenizer.json',join(directory,'tokenizer.json')).replaceAll('models/gpt2-forward.safetensors',join(directory,'gpt2-forward.safetensors'));
const checks=[],profiles=[],loads=[],outputs=[];
const check=(actual,expected,label)=>{assert.equal(actual.length,expected.length);let maxError=0;actual.forEach((v,i)=>{const e=Math.abs(v-expected[i]);maxError=Math.max(maxError,e);assert.ok(Number.isFinite(v)&&e<=5e-4+Math.abs(expected[i])*1e-4,`${label} ${i}: ${v} != ${expected[i]}`);});checks.push({label,values:actual.length,maxError});};
const tokens=new Interpreter();tokens.variables.set('Config',config);tokens.execute('use text');
for(const c of tokenizerReference.cases){tokens.variables.set('Text',c.text);const ids=tokens.execute('Ids = Text bpeencode Config');assert.deepEqual(ids.items.map(Number),c.ids);assert.equal(tokens.execute('Ids bpedecode Config'),c.decoded);}
tokens.dispose();
const cells=[];let depth=0,block=[];
for(const line of source.trim().split('\n')){
 if(/^(for |if )/.test(line))depth++;
 if(depth||block.length){block.push(line);if(line==='end')depth--;if(depth===0){cells.push(block.join('\n'));block=[];}}
 else cells.push(line);
}
writeFileSync(join(directory,'generation-fixture.json'),JSON.stringify({reference,tokenizerReference,config,source,cells,modules}));
if(process.argv.includes('--compile-only')){console.log(JSON.stringify({tokenizerCases:tokenizerReference.cases.length}));process.exit();}
const io={...nodeIo,open(...args){const h=nodeIo.open(...args),read=h.read.bind(h);h.read=n=>{if(args[0]===join(directory,'gpt2-forward.safetensors')&&h.position()+n>fixture.headerBytes)throw Error('Weight payload entered JavaScript');return read(n);};return h;}};
const client=createRamClient(request=>{const reply=sendRamGpu({...request,...(request.action==='invoke'?{profile:true}:{})});if(request.action==='load')loads.push(reply);if(request.action==='invoke'&&!reply.error){const {output,...p}=reply;profiles.push(p);}return reply;});
let call=0,run=0;
const runtime=new Interpreter(undefined,{io,loadModule:n=>({id:n,source:modules[n]}),ramGpu:(g,input,files)=>{
 const size=g.outputShape.reduce((a,b)=>a*b,1),out=client.invoke(g,()=>Buffer.from(g.model).toString('base64'),input,size,g.inputs.map(i=>i.shape.reduce((a,b)=>a*b,1)),files,g.reservationBytes,g.inputs.map(i=>i.dtype??'f32')).output;
 const step=Math.floor(call/79),part=call%79-29;
 if(part>=0){const row=reference.steps[step].input.length-1,width=size/4,actual=out.slice(row*width,(row+1)*width);check(actual,reference.steps[step].logits.slice(part*1024,part*1024+width),`run-${run}-step-${step}-head-${part}`);outputs[run].push(actual);}
 call++;return out;
}});
try{
 for(run=0;run<2;run++){
  call=0;outputs.push([]);
  let program=run?source.replace('Padded = array shape 4 fill 50256','Padded = array shape 4 fill 0'):source.replace('MaxNew = 3','MaxNew = 4');
  if(run)program=program.replace(/^use "[^\n]+\n/gm,'');
  assert.equal(runtime.execute(local(program)),reference.text);assert.equal(call,reference.steps.length*79);
  assert.deepEqual(runtime.variables.get('Tokens').items.map(Number),reference.tokens);
  assert.equal(runtime.variables.get('StopReason'),run?'token limit':'context limit');
 }
 assert.deepEqual(outputs[0],outputs[1]);
 assert.equal(loads.length,36);
 assert.ok(profiles.every(p=>p.residentModels<=4&&p.residentBytes<=128*1024*1024));
 const boundary=[];
 for(const [prompt,limit,reason] of [['Hello',0,'token limit'],['Hello, world!',3,'context limit'],['<|endoftext|>',3,'eos']]){
  const before=profiles.length;
  const program=source.replace(/^use "[^\n]+\n/gm,'').replace('Prompt = "Hello"','Prompt = '+JSON.stringify(prompt)).replace('MaxNew = 3','MaxNew = '+limit);
  assert.equal(runtime.execute(local(program)),prompt);assert.equal(runtime.variables.get('StopReason'),reason);assert.equal(profiles.length,before);boundary.push(reason);
 }
 for(const [prompt,limit,message] of [['',3,'at least one'],['Hello, world! Hello',3,'at most four'],['Hello',-1,'nonnegative'],['Hello','1.5','integer']]){
  const before=profiles.length;
  const program=source.replace(/^use "[^\n]+\n/gm,'').replace('Prompt = "Hello"','Prompt = '+JSON.stringify(prompt)).replace('MaxNew = 3','MaxNew = '+limit);
  assert.throws(()=>runtime.execute(local(program)),new RegExp(message));assert.equal(profiles.length,before);
 }
 let eosCalls=0;
 const eos=new Interpreter(undefined,{io,loadModule:n=>({id:n,source:modules[n]}),ramGpu:g=>{eosCalls++;const n=g.outputShape.reduce((a,b)=>a*b,1),values=Array(n).fill(0);if(g.outputShape[1]===81)for(let row=0;row<4;row++)values[row*81+80]=1;return values;}});
 try{assert.equal(eos.execute(local(source)),reference.prompt);assert.equal(eos.variables.get('StopReason'),'eos');assert.equal(eosCalls,79);}finally{eos.dispose();}
 client.release();
 console.log(JSON.stringify({tokenizerCases:tokenizerReference.cases.length,text:reference.text,tokens:reference.tokens,generatedTokens:reference.steps.map(s=>s.next),gpuCalls:profiles.length,valuesCompared:checks.reduce((n,c)=>n+c.values,0),paddingInvariant:true,boundary,invalidPromptsRejected:true,generatedEosMockVerified:true,checks,loads,profiles},null,2));
}finally{runtime.dispose();closeRamGpu();}
