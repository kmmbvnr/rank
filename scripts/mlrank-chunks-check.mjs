import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {Interpreter,createRamClient} from '../packages/interpreter/out/index.js';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const directory=resolve(process.argv[2]),fixture=JSON.parse(readFileSync(join(directory,'fixture.json')));
const ram=readFileSync(new URL('../demos/mlrank/chunkdot.ram',import.meta.url),'utf8');
const source=readFileSync(new URL('../demos/mlrank/file-chunks.ra',import.meta.url),'utf8').replace('X = array shape 1 8192 fill 0.5\n','').replace('Result = Result + Y','Repeat = Input chunkdot Weights\nResult = Result + Y');
writeFileSync(join(directory,'chunks-fixture.json'),JSON.stringify({...fixture,ram,source}));
let jsPayloadBytes=0,maxError=0;const profiles=[],loads=[];
const check=(values,expected)=>{assert.equal(values.length,expected.length);values.forEach((v,i)=>{const error=Math.abs(v-expected[i]);maxError=Math.max(maxError,error);assert.ok(error<=1e-5+Math.abs(expected[i])*1e-4,`${i}: ${v} != ${expected[i]}`);});};
const io={...nodeIo,open(...args){const h=nodeIo.open(...args),read=h.read.bind(h);h.read=n=>{if(args[0].endsWith('chunks.safetensors')&&h.position()+n>fixture.headerBytes){jsPayloadBytes+=n;throw Error('Weights entered JS');}return read(n);};return h;}};
const client=createRamClient(request=>{const reply=sendRamGpu({...request,...(request.action==='invoke'?{profile:true}:{})});if(request.action==='load')loads.push(reply);if(request.action==='invoke'&&!reply.error){const {output,...p}=reply;profiles.push(p);}return reply;});
let calls=0;
const r=new Interpreter(undefined,{io,loadModule:()=>({id:'chunkdot.ram',source:ram}),ramGpu:(g,input,files)=>{
 assert.equal(input.length,2048);assert.equal(files[1].length,8*1024*1024);assert.equal(files[1].offset,fixture.headerBytes+Math.floor(calls/2)*8*1024*1024);
 const result=client.invoke(g,()=>Buffer.from(g.model).toString('base64'),input,1024,[2048,2048*1024],files,g.reservationBytes).output;
 check(result,fixture.parts[Math.floor(calls/2)]);calls++;return result;
}});
try{
 r.variables.set('X',{kind:'array',shape:[1,8192],items:fixture.x});
 const output=r.execute(source.replace('models/chunks.safetensors',join(directory,'chunks.safetensors')));check(output.items,fixture.expected);
 assert.equal(calls,8);assert.equal(loads.length,1);
 profiles.forEach((p,i)=>{assert.equal(p.fileBytesRead,i%2?0:8*1024*1024);assert.equal(p.fileInputsReused,i%2?1:0);});client.release();
 console.log(JSON.stringify({weightBytes:32*1024*1024,chunkBytes:8*1024*1024,gpuCalls:calls,jsPayloadBytes,valuesCompared:9*1024,maxError,loads,profiles},null,2));
}finally{r.dispose();closeRamGpu();}
