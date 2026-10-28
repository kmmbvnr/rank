import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {Interpreter,createRamClient} from '../packages/interpreter/out/index.js';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const path=resolve(process.argv[2]),f=JSON.parse(readFileSync(process.argv[3]));
const ram=readFileSync(new URL('../demos/mlrank/embedding.ram',import.meta.url),'utf8');
const demo=readFileSync(new URL('../demos/mlrank/file-embedding.ra',import.meta.url),'utf8');
const second=f.cases[1],source=demo.replace('F close',`Tokens = array ${second.ids.join(' ')}\nPositions = array ${second.positions.join(' ')}\nResult = Table embedding Tokens Positional Positions\nF close`);
writeFileSync(process.argv[3]+'.fixture.json',JSON.stringify({...f,ram,source}));
const profiles=[],loads=[];let calls=0,maxError=0;
const io={...nodeIo,open(...args){const h=nodeIo.open(...args),read=h.read.bind(h);h.read=n=>{if(args[0]===path&&h.position()+n>f.headerBytes)throw Error('Weights entered JS');return read(n);};return h;}};
const client=createRamClient(request=>{const reply=sendRamGpu({...request,...(request.action==='invoke'?{profile:true}:{})});if(request.action==='load')loads.push(reply);if(request.action==='invoke'&&!reply.error){const {output,...p}=reply;profiles.push(p);}return reply;});
const check=(values,expected)=>{assert.equal(values.length,expected.length);values.forEach((v,i)=>{const e=Math.abs(v-expected[i]);maxError=Math.max(e,maxError);assert.ok(e<1e-6);});};
const r=new Interpreter(undefined,{io,loadModule:()=>({id:'embedding.ram',source:ram}),ramGpu:(g,input,files)=>{
 assert.deepEqual(input,[...f.cases[calls].ids,...f.cases[calls].positions]);assert.equal(files.filter(Boolean).length,2);
 const out=client.invoke(g,()=>Buffer.from(g.model).toString('base64'),input,4096,g.inputs.map(i=>i.shape.reduce((a,b)=>a*b,1)),files,g.reservationBytes,g.inputs.map(i=>i.dtype??'f32')).output;
 check(out,f.cases[calls].expected);calls++;return out;
}});
try{check(r.execute(source.replace('models/chunks.safetensors',path)).items,second.expected);assert.equal(loads.length,1);assert.equal(calls,2);assert.equal(profiles[0].fileBytesRead,2176*1024*4);assert.equal(profiles[1].fileBytesRead,0);assert.equal(profiles[1].fileInputsReused,2);client.release();console.log(JSON.stringify({gpuCalls:calls,valuesCompared:12288,maxError,loads,profiles},null,2));}finally{r.dispose();closeRamGpu();}
