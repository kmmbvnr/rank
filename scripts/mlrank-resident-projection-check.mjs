// Real GPT-2 QKV weights. The reference reads weights only in this test process;
// the ordinary Rank call path is instrumented to reject JS payload reads.
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Interpreter,compileRam} from '../packages/interpreter/out/index.js';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const root=resolve(process.argv[2]), raw=readFileSync(join(root,'gpt2-qkv.bin'));
assert.equal(raw.length,768*2304*4);
assert.equal(createHash('sha256').update(raw).digest('hex'),'df332e9d9ae908db358a00423f14af1c0036bc9a2332aca395adf68e3eb08b48','Wrong GPT-2 revision or tensor bytes');
const header=Buffer.from(JSON.stringify({weight:{dtype:'F32',shape:[768,2304],data_offsets:[0,raw.length]}}));
const prefix=Buffer.alloc(8+header.length);prefix.writeBigUInt64LE(BigInt(header.length));header.copy(prefix,8);
const path=join(root,'qkv.safetensors');writeFileSync(path,Buffer.concat([prefix,raw]));
const ram='use ml\narg X .f32 shape 1 768\narg W .f32 shape 768 2304\nreturn X matmul W\n';
const graph=compileRam(ram,'projection.ram').graph, model=Buffer.from(graph.model).toString('base64');
// Bounded deterministic activations, with every component changing on the second call.
const xs=[0,1].map(run=>Array.from({length:768},(_,i)=>Math.fround(Math.sin(i*0.17+run*0.53)*0.5)));
const expected=xs.map(x=>Array.from({length:2304},(_,j)=>{let sum=0;for(let k=0;k<768;k++)sum+=x[k]*raw.readFloatLE((k*2304+j)*4);return sum;}));
const fixture={ram,model,inputSizes:[768,768*2304],xs,expected,headerBytes:prefix.length,fileSize:statSync(path).size,weightBytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')};
writeFileSync(join(root,'projection-fixture.json'),JSON.stringify(fixture));
if(process.argv.includes('--compile-only')){console.log(JSON.stringify({fixture:join(root,'projection-fixture.json'),modelBytes:graph.model.length}));process.exit();}
let jsBytes=0,modelId,descriptor;const profiles=[];
const io={...nodeIo,open(...args){const h=nodeIo.open(...args),read=h.read.bind(h);h.read=n=>{assert.ok(h.position()+n<=prefix.length,'Payload read into JS');jsBytes+=n;return read(n);};return h;}};
const load=()=>{const r=sendRamGpu({action:'load',model,inputSizes:fixture.inputSizes});assert.ok(r.modelId,r.error);assert.equal(r.fullyAccelerated,true);modelId=r.modelId;};
const invoke=(input,files)=>{const r=sendRamGpu({action:'invoke',modelId,input,inputFiles:files,outputSize:2304,profile:true});assert.ok(!r.error,r.error);const {output,...profile}=r;profiles.push(profile);return output;};
const interpreter=new Interpreter(undefined,{io,loadModule:()=>({id:'projection.ram',source:ram}),ramGpu:(g,input,files)=>{assert.equal(input.length,768);descriptor=files[1];if(!modelId)load();return invoke(input,files);}});
let maxError=0;
const check=(actual,wanted)=>{assert.equal(actual.length,wanted.length);actual.forEach((v,i)=>{maxError=Math.max(maxError,Math.abs(v-wanted[i]));assert.ok(Math.abs(v-wanted[i])<=1e-4+Math.abs(wanted[i])*1e-4,`Mismatch ${i}: ${v} != ${wanted[i]}`);});};
try{
 interpreter.execute(`use io\nuse "projection.ram"`);
 for(const index of [0,1,0]){interpreter.variables.set('X',{kind:'array',shape:[1,768],items:xs[index]});check(interpreter.execute(`F = ${JSON.stringify(path)} open\nW' = F tensor "weight"\nX projection W`).items,expected[index]);}
 assert.equal(profiles[0].fileBytesRead,raw.length);assert.equal(profiles[1].fileBytesRead,0);assert.equal(profiles[2].fileInputsReused,1);
 const invalid=sendRamGpu({action:'invoke',modelId,input:xs[0],inputFiles:[null,{...descriptor,revision:'stale'}],outputSize:2304});assert.match(invalid.error,/changed/);
 check(invoke(xs[1],[null,descriptor]),expected[1]);assert.equal(profiles.at(-1).fileBytesRead,0);
 sendRamGpu({action:'release',modelId});load();check(invoke(xs[0],[null,descriptor]),expected[0]);assert.equal(profiles.at(-1).fileBytesRead,raw.length);
 console.log(JSON.stringify({weightBytes:raw.length,weightSha256:fixture.sha256,modelBytes:graph.model.length,jsBytes,headerBytes:prefix.length,maxError,valuesCompared:2304*5,staleRejected:true,reloadReadsWeights:true,profiles},null,2));
}finally{interpreter.dispose();closeRamGpu();}
