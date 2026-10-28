import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {Interpreter,compileRam,createRamClient} from '../packages/interpreter/out/index.js';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';

const directory=resolve(process.argv[2]);
const fixture=JSON.parse(readFileSync(join(directory,'fixture.json')));
assert.equal(fixture.layers,12);
const path=join(directory,fixture.filename);
const modules=Object.fromEntries(['gpt2embed','gpt2attn','gpt2mlp','gpt2norm'].map(name=>[
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
F = "models/gpt2-stack.safetensors" open
F verify "${fixture.sha256}"
TokenTable' = F tensor "wte.weight"
PositionTable' = F tensor "wpe.weight"
Tokens = array 0 1 2 3
Positions = array 0 1 2 3
X = TokenTable gpt2embed Tokens PositionTable Positions
${loop}
G' = F tensor "ln_f.weight"
B' = F tensor "ln_f.bias"
Result = X gpt2norm G B
F close
Result
`;
const graphs=Object.fromEntries(Object.entries(modules).map(([name,s])=>{
 const g=compileRam(s,name).graph;
 return [name,{nodes:g.nodes.length,modelBytes:g.model.length,reservationBytes:g.reservationBytes}];
}));
// Keep the complete loop in one cell in Android notebooks.
const before=source.slice(0,source.indexOf('for Layer'));
const after=source.slice(source.indexOf('\nG\' =')+1);
const cells=[...before.trim().split('\n'),loop,...after.trim().split('\n')];
const expected=fixture.cases.map(c=>[
 {label:'embedding',values:fixture.cases[0].input},
 ...c.blocks.flatMap((b,i)=>[{label:`block-${i}-attention`,values:b.Residual1},{label:`block-${i}-output`,values:b.Output}]),
 {label:'final-norm',values:c.final}
]);
const changed='X = array shape 4 768\n'+fixture.cases[1].input.map(v=>Number.isInteger(v)?v+'.0':String(v)).join(' ')+'\nend\nfor Layer';
const sources=[source,source.replace('for Layer',changed),source];
const contract={...fixture,modules,source,cells,sources,graphs,expected,tolerance:{absolute:5e-4,relative:1e-4}};
writeFileSync(join(directory,'stack-fixture.json'),JSON.stringify(contract));
if(process.argv.includes('--write-demo'))writeFileSync('demos/mlrank/gpt2-stack.ra',source);
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
 assert.equal(files.filter(Boolean).length,callIndex===0||callIndex===25?2:6);
 const reply=client.invoke(graph,()=>Buffer.from(graph.model).toString('base64'),input,3072,graph.inputs.map(i=>i.shape.reduce((a,b)=>a*b,1)),files,graph.reservationBytes,graph.inputs.map(i=>i.dtype??'f32'));
 check(reply.output,reference.values,`run-${runIndex}-${reference.label}`);
 allOutputs[runIndex].push(reply.output);
 callIndex++;
 return reply.output;
}});
try{
 const started=performance.now();
 for(runIndex=0;runIndex<sources.length;runIndex++){
  callIndex=0;allOutputs.push([]);
  const program=sources[runIndex].replace('models/gpt2-stack.safetensors',path).replace(runIndex? /^use "[^\n]+\n/gm : /$^/g,'');
  check(interpreter.execute(program).items,expected[runIndex===1?1:0][25].values,`run-${runIndex}-returned`);
  assert.equal(callIndex,26);
 }
 // Both attention and MLP outputs must preserve all earlier tokens at every depth.
 for(let i=1;i<26;i++)assert.deepEqual(allOutputs[0][i].slice(0,2304),allOutputs[1][i].slice(0,2304));
 assert.deepEqual(allOutputs[0],allOutputs[2]);
 assert.equal(loads.length,4,'Graphs must be reused across all twelve layers and runs');
 assert.ok(profiles.every(p=>p.residentModels<=4&&p.residentBytes<=128*1024*1024));
 const elapsedMs=performance.now()-started;
 client.release();
 console.log(JSON.stringify({revision:fixture.revision,graphs,gpuCalls:profiles.length,valuesCompared:checks.reduce((n,c)=>n+c.values,0),checks,causalityVerified:true,repeatVerified:true,elapsedMs,loads,profiles},null,2));
}finally{interpreter.dispose();closeRamGpu();}
