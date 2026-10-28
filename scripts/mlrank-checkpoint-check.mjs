// Full Rank -> locked multi-file checkpoint -> resident GPU path.
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {Interpreter} from '../packages/interpreter/out/index.js';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const inputRoot=resolve(process.argv[2]),directory=mkdtempSync(join(tmpdir(),'rank-checkpoint-'));
for(const name of ['qkv.safetensors','gpt2-ln1.safetensors'])copyFileSync(join(inputRoot,name),join(directory,name));
const weight_map={weight:'qkv.safetensors','h.0.ln_1.weight':'gpt2-ln1.safetensors'};
const plain=join(directory,'model.safetensors.index.json'),locked=join(directory,'locked.safetensors.index.json');
writeFileSync(plain,JSON.stringify({weight_map}));
const report=JSON.parse(execFileSync(process.execPath,['scripts/mlrank-lock-checkpoint.mjs',plain,locked],{encoding:'utf8'}));
const bytes=name=>{const b=readFileSync(join(directory,name)),offset=8+Number(b.readBigUInt64LE());return {b,offset};};
const q=bytes('qkv.safetensors'),s=bytes('gpt2-ln1.safetensors');
const x=Array.from({length:768},(_,i)=>Math.fround(Math.sin(i*0.17)*0.5));
const expected=Array.from({length:2304},(_,j)=>{let sum=0;for(let k=0;k<768;k++)sum+=Math.fround(x[k]*s.b.readFloatLE(s.offset+k*4))*q.b.readFloatLE(q.offset+(k*2304+j)*4);return sum;});
const ram='use ml\narg X .f32 shape 1 768\narg W .f32 shape 768 2304\narg S .f32 shape 768\nreturn (X * S) matmul W\n';
const source=path=>`use io\nuse "sharded.ram"\nF = ${JSON.stringify(path)} open\nF verify "${report.sha256}"\nInfo = F safetensors\nW' = F tensor "weight"\nS' = F tensor "h.0.ln_1.weight"\nA = X sharded W S\nB = (X * 0.5) sharded W S\nC = X sharded W S\nF close\nC`;
const fixture={directory,ram,source:source('models/locked.safetensors.index.json'),manifestSha256:report.sha256,x,expected,headers:{'qkv.safetensors':q.offset,'gpt2-ln1.safetensors':s.offset},manifestBytes:readFileSync(locked).length};
writeFileSync(join(directory,'fixture.json'),JSON.stringify(fixture));
if(process.argv.includes('--compile-only')){console.log(JSON.stringify({directory}));process.exit();}
let hashes=0,jsBytes=0,modelId,maxError=0;const profiles=[];
const io={...nodeIo,open(...args){const h=nodeIo.open(...args),read=h.read.bind(h),hash=h.sha256.bind(h);h.read=n=>{const bound=fixture.headers[args[0].split('/').at(-1)];if(bound)assert.ok(h.position()+n<=bound,'Shard payload read into JS');jsBytes+=n;return read(n);};h.sha256=()=>{hashes++;return hash();};return h;}};
const r=new Interpreter(undefined,{io,loadModule:()=>({id:'sharded.ram',source:ram}),ramGpu:(g,input,files)=>{
 assert.equal(input.length,768);assert.equal(files.filter(Boolean).length,2);
 if(!modelId){const loaded=sendRamGpu({action:'load',model:Buffer.from(g.model).toString('base64'),inputSizes:g.inputs.map(i=>i.shape.reduce((a,b)=>a*b,1))});assert.equal(loaded.fullyAccelerated,true,loaded.error);modelId=loaded.modelId;}
 const {output,...profile}=sendRamGpu({action:'invoke',modelId,input,inputFiles:files,outputSize:2304,profile:true});assert.ok(!profile.error,profile.error);
 const factor=profiles.length===1?0.5:1;output.forEach((v,i)=>{const error=Math.abs(v-expected[i]*factor);maxError=Math.max(maxError,error);assert.ok(error<=1e-4+Math.abs(expected[i]*factor)*1e-4);});profiles.push(profile);return output;
}});
try{
 r.variables.set('X',{kind:'array',shape:[1,768],items:x});r.execute(source(locked));assert.equal(hashes,3);assert.equal(profiles[1].fileBytesRead,0);assert.equal(profiles[2].fileInputsReused,2);
 console.log(JSON.stringify({directory,manifestSha256:report.sha256,shards:2,hashes,jsBytes,maxError,valuesCompared:3*2304,profiles},null,2));
}finally{r.dispose();closeRamGpu();}
