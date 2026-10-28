import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {Interpreter,compileRam,createRamClient} from '../packages/interpreter/out/index.js';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';

const directory=resolve(process.argv[2]);
const fixture=JSON.parse(readFileSync(join(directory,'fixture.json')));
assert.equal(fixture.layers,12);
assert.equal(fixture.fullVocabulary,true);
const path=join(directory,fixture.filename);
const modules=Object.fromEntries(['gpt2row','gpt2attn','gpt2mlp','gpt2norm','gpt2head','gpt2tail'].map(name=>[
 name+'.ram',readFileSync(new URL('../demos/mlrank/'+name+'.ram',import.meta.url),'utf8')
]));
const weights={G1:'ln_1.weight',B1:'ln_1.bias',W:'attn.c_attn.weight',QkvBias:'attn.c_attn.bias',O:'attn.c_proj.weight',OutBias:'attn.c_proj.bias',G2:'ln_2.weight',B2:'ln_2.bias',UpW:'mlp.c_fc.weight',UpB:'mlp.c_fc.bias',DownW:'mlp.c_proj.weight',DownB:'mlp.c_proj.bias'};
const loop=`for Layer in 0 till 12
Prefix = "h." + (Layer text) + "."
${Object.entries(weights).map(([name,key])=>`${name}' = F tensor (Prefix + "${key}")`).join('\n')}
H = X gpt2attn G1 B1 W QkvBias O OutBias
X = H gpt2mlp G2 B2 UpW UpB DownW DownB
end`;
const source=`use io
${Object.keys(modules).map(n=>`use "${n}"`).join('\n')}
F = "models/gpt2-forward.safetensors" open
F verify "${fixture.sha256}"
TokenTable' = F tensor "wte.weight"
PositionTable' = F tensor "wpe.weight"
Tokens = array 0 127 8192 50256
Positions = array 0 1 2 3
X = array shape 4 768 fill 0.0
for I in 0 till 4
Token = Tokens I
Position = Positions I
Row' = TokenTable (Token till (Token + 1)) #
Pos' = PositionTable (Position till (Position + 1)) #
Y = Row gpt2row Pos
X (I till (I + 1)) # = Y
end
${loop}
G' = F tensor "ln_f.weight"
B' = F tensor "ln_f.bias"
Hidden = X gpt2norm G B
Result = array shape 4 50257 fill 0.0
for Start in 0 till 50176 by 1024
Part' = TokenTable (Start till (Start + 1024)) #
Y = Hidden gpt2head Part
Result # (Start till (Start + 1024)) = Y
end
Part' = TokenTable (50176 till 50257) #
Y = Hidden gpt2tail Part
Result # (50176 till 50257) = Y
F close
Result
`;
const graphs=Object.fromEntries(Object.entries(modules).map(([name,s])=>{
 const g=compileRam(s,name).graph;
 return [name,{nodes:g.nodes.length,modelBytes:g.model.length,reservationBytes:g.reservationBytes}];
}));
// Keep each complete loop in one Android notebook cell.
const cells=[];let block=[];
for(const line of source.trim().split('\n')){
 if(line.startsWith('for ')||block.length){block.push(line);if(line==='end'){cells.push(block.join('\n'));block=[];}}
 else cells.push(line);
}
const expected=fixture.cases.map(c=>[
 ...Array.from({length:4},(_,i)=>({label:`embedding-${i}`,values:c.input.slice(i*768,(i+1)*768)})),
 ...c.blocks.flatMap((b,i)=>[{label:`block-${i}-attention`,values:b.Residual1},{label:`block-${i}-output`,values:b.Output}]),
 {label:'final-norm',values:c.final},
 ...Array.from({length:50},(_,i)=>({label:`head-${i}`,values:Array.from({length:4},(_,row)=>c.logits.slice(row*50257+i*1024,row*50257+Math.min((i+1)*1024,50257))).flat()}))
]);
const sources=[source,source.replace('array 0 127 8192 50256','array 0 127 8192 256'),source];
const contract={revision:fixture.revision,sha256:fixture.sha256,cases:fixture.cases.map(({tokens,positions,argmax,logits})=>({tokens,positions,argmax,logits})),modules,source,cells,sources,graphs,expected:expected.map(e=>e.slice(0,29)),tolerance:{absolute:5e-4,relative:1e-4}};
writeFileSync(join(directory,'forward-fixture.json'),JSON.stringify(contract));
if(process.argv.includes('--write-demo'))writeFileSync('demos/mlrank/gpt2-forward.ra',source);
if(process.argv.includes('--compile-only')){console.log(JSON.stringify({graphs}));process.exit();}

const checks=[],profiles=[],loads=[],allOutputs=[];
let runIndex=0,callIndex=0;
const check=(values,reference,label)=>{
 assert.equal(values.length,reference.length);
 let maxError=0;
 values.forEach((v,i)=>{const e=Math.abs(v-reference[i]);maxError=Math.max(maxError,e);assert.ok(Number.isFinite(v)&&e<=contract.tolerance.absolute+Math.abs(reference[i])*contract.tolerance.relative,`${label} ${i}: ${v} != ${reference[i]}, error ${e}`);});
 checks.push({label,values:values.length,maxError});
};
const client=createRamClient(request=>{
 const reply=sendRamGpu({...request,...(request.action==='invoke'?{profile:true}:{})});
 if(request.action==='load')loads.push(reply);
 if(request.action==='invoke'&&!reply.error){const {output,...profile}=reply;profiles.push(profile);}
 return reply;
});
const io={...nodeIo,open(...args){
 const h=nodeIo.open(...args),read=h.read.bind(h);
 h.read=n=>{if(args[0]===path&&h.position()+n>fixture.headerBytes)throw Error('Weight payload entered JavaScript');return read(n);};
 return h;
}};
const interpreter=new Interpreter(undefined,{io,loadModule:name=>({id:name,source:modules[name]}),ramGpu:(graph,input,files)=>{
 const reference=expected[runIndex===1?1:0][callIndex];
 assert.ok(reference,'Unexpected GPU call');
 assert.equal(files.filter(Boolean).length,callIndex<4||callIndex===28?2:callIndex>28?1:6);
 if(callIndex<4||callIndex>28){
  const tableOffset=fixture.headerBytes+fixture.entries.slice(0,fixture.entries.findIndex(e=>e.name==='wte.weight')).reduce((n,e)=>n+e.length,0);
  const file=files[callIndex<4?0:1],row=callIndex<4?fixture.cases[runIndex===1?1:0].tokens[callIndex]:(callIndex-29)*1024;
  assert.equal(file.path,path);assert.equal(file.offset,tableOffset+row*768*4,'Embedding and head must share the same tensor bytes');
 }
 const reply=client.invoke(graph,()=>Buffer.from(graph.model).toString('base64'),input,reference.values.length,graph.inputs.map(i=>i.shape.reduce((a,b)=>a*b,1)),files,graph.reservationBytes,graph.inputs.map(i=>i.dtype??'f32'));
 check(reply.output,reference.values,`run-${runIndex}-${reference.label}`);
 allOutputs[runIndex].push(reply.output);
 callIndex++;
 return reply.output;
}});
try{
 const started=performance.now();
 for(runIndex=0;runIndex<sources.length;runIndex++){
  callIndex=0;allOutputs.push([]);
  const program=sources[runIndex].replace('models/gpt2-forward.safetensors',path).replace(runIndex? /^use "[^\n]+\n/gm : /$^/g,'');
  check(interpreter.execute(program).items,fixture.cases[runIndex===1?1:0].logits,`run-${runIndex}-returned`);
  assert.equal(callIndex,79);
 }
 // Both attention and MLP outputs must preserve all earlier tokens at every depth.
 for(let i=4;i<79;i++){const earlier=allOutputs[0][i].length/4*3;assert.deepEqual(allOutputs[0][i].slice(0,earlier),allOutputs[1][i].slice(0,earlier));}
 assert.deepEqual(allOutputs[0],allOutputs[2]);
 assert.equal(loads.length,18,'Six graphs per pass; block iterations must reuse their graphs');
 assert.ok(profiles.every(p=>p.residentModels<=4&&p.residentBytes<=128*1024*1024));
 const argmax=[];
 for(let run=0;run<3;run++){
  const rows=Array.from({length:4},()=>[]);
  for(const values of allOutputs[run].slice(29))for(let row=0;row<4;row++)rows[row].push(...values.slice(row*values.length/4,(row+1)*values.length/4));
  const ids=rows.map(values=>values.reduce((best,value,i)=>value>values[best]?i:best,0));
  assert.deepEqual(ids,fixture.cases[run===1?1:0].argmax);argmax.push(ids);
 }
 const elapsedMs=performance.now()-started;
 client.release();
 console.log(JSON.stringify({revision:fixture.revision,graphs,gpuCalls:profiles.length,valuesCompared:checks.reduce((n,c)=>n+c.values,0),checks,causalityVerified:true,repeatVerified:true,argmax,elapsedMs,loads,profiles},null,2));
}finally{interpreter.dispose();closeRamGpu();}
