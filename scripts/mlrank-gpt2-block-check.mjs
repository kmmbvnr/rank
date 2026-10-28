import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {Interpreter,compileRam,createRamClient} from '../packages/interpreter/out/index.js';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const directory=resolve(process.argv[2]),fixture=JSON.parse(readFileSync(join(directory,'fixture.json'))),path=join(directory,'gpt2-block0.safetensors');
const modules=Object.fromEntries(['gpt2embed','gpt2attn','gpt2mlp'].map(n=>[n+'.ram',readFileSync(new URL('../demos/mlrank/'+n+'.ram',import.meta.url),'utf8')]));
const names={G1:'h.0.ln_1.weight',B1:'h.0.ln_1.bias',W:'h.0.attn.c_attn.weight',QkvBias:'h.0.attn.c_attn.bias',O:'h.0.attn.c_proj.weight',OutBias:'h.0.attn.c_proj.bias',G2:'h.0.ln_2.weight',B2:'h.0.ln_2.bias',UpW:'h.0.mlp.c_fc.weight',UpB:'h.0.mlp.c_fc.bias',DownW:'h.0.mlp.c_proj.weight',DownB:'h.0.mlp.c_proj.bias',TokenTable:'wte.weight',PositionTable:'wpe.weight'};
const bindings=Object.entries(names).map(([n,key])=>`${n}' = F tensor "${key}"`).join('\n');
const attention='X gpt2attn G1 B1 W QkvBias O OutBias',mlp='H gpt2mlp G2 B2 UpW UpB DownW DownB';
const open=p=>`F = ${JSON.stringify(p)} open\nF verify "${fixture.sha256}"\n${bindings}`;
const source=`use io\n${Object.keys(modules).map(n=>`use "${n}"`).join('\n')}\n${open('models/gpt2-block0.safetensors')}\nTokens = array 0 1 2 3\nPositions = array 0 1 2 3\nX = TokenTable gpt2embed Tokens PositionTable Positions\nH = ${attention}\nResult = ${mlp}\nF close\nResult\n`;
if(process.argv.includes('--write-demo'))writeFileSync('demos/mlrank/gpt2-block0.ra',source);
const graphs=Object.fromEntries(Object.entries(modules).map(([n,s])=>{const g=compileRam(s,n).graph;return [n,{nodes:g.nodes.length,reservationBytes:g.reservationBytes,modelBytes:g.model.length}];}));
const stages=[['gpt2attn.ram','Norm1'],['gpt2attn.ram','Projection'],['gpt2attn.ram','Probabilities'],['gpt2mlp.ram','Activated']].map(([name,stage])=>{
 const text=modules[name],at=text.indexOf(stage+' ='),end=text.indexOf('\n',at);return {name,stage,source:text.slice(0,end+1)+'return '+stage+'\n',input:stage==='Activated'?fixture.cases[0].stages.Residual1:fixture.cases[0].input,expected:fixture.cases[0].stages[stage]};
});
writeFileSync(join(directory,'block-fixture.json'),JSON.stringify({...fixture,modules,source,graphs,stages}));
if(process.argv.includes('--compile-only')){console.log(JSON.stringify({graphs}));process.exit();}
const profiles=[],loads=[],checks=[];let count=0;const outputs=[];
const check=(values,expected,label)=>{assert.equal(values.length,expected.length);let maxError=0;values.forEach((v,i)=>{const e=Math.abs(v-expected[i]);maxError=Math.max(maxError,e);assert.ok(e<=5e-4+Math.abs(expected[i])*1e-4,`${label} ${i}: ${v} != ${expected[i]}`);});checks.push({label,values:values.length,maxError});if(label==='Probabilities')for(let at=0;at<values.length;at+=4){assert.ok(Math.abs(values.slice(at,at+4).reduce((a,b)=>a+b,0)-1)<1e-5);for(let j=(at/4)%4+1;j<4;j++)assert.equal(values[at+j],0);}};
const client=createRamClient(request=>{const reply=sendRamGpu({...request,...(request.action==='invoke'?{profile:true}:{})});if(request.action==='load')loads.push(reply);if(request.action==='invoke'&&!reply.error){const {output,...p}=reply;profiles.push(p);}return reply;});
const io={...nodeIo,open(...args){const h=nodeIo.open(...args),read=h.read.bind(h);h.read=n=>{if(args[0]===path&&h.position()+n>fixture.headerBytes)throw Error('Weights entered JS');return read(n);};return h;}};
const invoke=(g,input,files)=>client.invoke(g,()=>Buffer.from(g.model).toString('base64'),input,g.outputShape.reduce((a,b)=>a*b,1),g.inputs.map(i=>i.shape.reduce((a,b)=>a*b,1)),files,g.reservationBytes,g.inputs.map(i=>i.dtype??'f32')).output;
const expected=[fixture.cases[0].input,fixture.cases[0].stages.Residual1,fixture.cases[0].stages.Output,fixture.cases[1].stages.Residual1,fixture.cases[1].stages.Output];
const r=new Interpreter(undefined,{io,loadModule:n=>({id:n,source:modules[n]}),ramGpu:(g,input,files)=>{assert.equal(files.filter(Boolean).length,count===0?2:6);const out=invoke(g,input,files);check(out,expected[count],['embedding','attention','output','changed-attention','changed-output'][count]);outputs.push(out);count++;return out;}});
try{
 const changed=fixture.cases[1].input.map(v=>Number.isInteger(v)?v+'.0':String(v)).join(' ');
 const program=source.replace('models/gpt2-block0.safetensors',path).replace('F close',`X = array shape 4 768\n${changed}\nend\nH = ${attention}\nResult = ${mlp}\nF close`);
 check(r.execute(program).items,expected[4],'returned');assert.equal(count,5);assert.equal(loads.length,3);assert.equal(profiles[3].fileBytesRead,0);assert.equal(profiles[4].fileBytesRead,0);
 assert.deepEqual(outputs[2].slice(0,2304),outputs[4].slice(0,2304));
 for(const stage of stages){
  const item=new Interpreter(undefined,{io,loadModule:n=>({id:n,source:stage.source}),ramGpu:(g,input,files)=>{const out=invoke(g,input,files);check(out,stage.expected,stage.stage);return out;}});
  try{item.variables.set(stage.stage==='Activated'?'H':'X',{kind:'array',shape:[4,768],items:stage.input});item.execute(`use io\nuse "${stage.name}"\n${open(path)}\nResult = ${stage.stage==='Activated'?mlp:attention}\nF close\nResult`);}finally{item.dispose();}
 }
 client.release();console.log(JSON.stringify({revision:fixture.revision,graphs,gpuCalls:profiles.length,valuesCompared:checks.reduce((n,c)=>n+c.values,0),checks,causalityVerified:true,loads,profiles},null,2));
}finally{r.dispose();closeRamGpu();}
