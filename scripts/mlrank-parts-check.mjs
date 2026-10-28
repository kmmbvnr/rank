// Two explicit RAM parts with real GPT-2 weights; admission, reuse and eviction.
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {Interpreter,compileRam,createRamClient} from '../packages/interpreter/out/index.js';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const directory=resolve(process.argv[2]),prior=JSON.parse(readFileSync(join(directory,'fixture.json')));
const modules={
 'partscale.ram':'use ml\narg X .f32 shape 1 768\narg S .f32 shape 768\nreturn X * S\n',
 'partqkv.ram':'use ml\narg X .f32 shape 1 768\narg W .f32 shape 768 2304\nreturn X matmul W\n',
};
const graphs=Object.fromEntries(Object.entries(modules).map(([name,source])=>[name,compileRam(source,name).graph]));
const scaleBytes=readFileSync(join(directory,'gpt2-ln1.safetensors')),scaleOffset=8+Number(scaleBytes.readBigUInt64LE());
const scaled=prior.x.map((v,i)=>Math.fround(v*scaleBytes.readFloatLE(scaleOffset+i*4)));
const source=path=>`use io\nuse "partscale.ram"\nuse "partqkv.ram"\nF = ${JSON.stringify(path)} open\nF verify "${prior.manifestSha256}"\nW' = F tensor "weight"\nS' = F tensor "h.0.ln_1.weight"\nY = X partscale S\nA = Y partqkv W\nY = (X * 0.5) partscale S\nB = Y partqkv W\nY = X partscale S\nC = Y partqkv W\nF close\nC`;
const fixture={...prior,modules,scaled,source:source('models/locked.safetensors.index.json'),graphs:Object.fromEntries(Object.entries(graphs).map(([name,g])=>[name,{model:Buffer.from(g.model).toString('base64'),inputSizes:g.inputs.map(i=>i.shape.reduce((a,b)=>a*b,1)),reservationBytes:g.reservationBytes}]))};
writeFileSync(join(directory,'parts-fixture.json'),JSON.stringify(fixture));
if(process.argv.includes('--compile-only')){console.log(JSON.stringify({directory}));process.exit();}
const pressure=compileRam('use ml\narg X .f32 shape 1\nreturn X relu','pressure.ram').graph;
const profiles=[],loads=[],releases=[];let successful=0,stale=0,maxError=0,pressureReply;
const client=createRamClient(request=>{
 const reply=sendRamGpu({...request,...(request.action==='invoke'?{profile:true}:{})});
 if(request.action==='load')loads.push(reply);
 if(reply.code==='STALE_MODEL')stale++;
 if(request.action==='release')releases.push(reply);
 if(request.action==='invoke'&&!reply.error){const {output,...profile}=reply;profiles.push(profile);}
 return reply;
});
const check=(values,expected,factor)=>{assert.equal(values.length,expected.length);values.forEach((v,i)=>{const e=Math.abs(v-expected[i]*factor);maxError=Math.max(maxError,e);assert.ok(e<=1e-4+Math.abs(expected[i]*factor)*1e-4);});};
const r=new Interpreter(undefined,{io:nodeIo,loadModule:name=>({id:name,source:modules[name]}),ramGpu:(g,input,files)=>{
 const out=client.invoke(g,()=>Buffer.from(g.model).toString('base64'),input,g.outputShape.reduce((a,b)=>a*b,1),g.inputs.map(i=>i.shape.reduce((a,b)=>a*b,1)),files,g.reservationBytes).output;
 const factor=successful===2||successful===3?0.5:1;check(out,successful%2===0?scaled:prior.expected,factor);successful++;
 if(successful===2){const rejected=sendRamGpu({action:'load',model:Buffer.from(pressure.model).toString('base64'),reservationBytes:128*1024*1024+1});assert.match(rejected.error,/budget/);}
 if(successful===4){pressureReply=sendRamGpu({action:'load',model:Buffer.from(pressure.model).toString('base64'),inputSizes:[1],reservationBytes:128*1024*1024});assert.equal(pressureReply.cacheEvictions,2);}
 return out;
}});
try{
 r.variables.set('X',{kind:'array',shape:[1,768],items:prior.x});r.execute(source(join(directory,'locked.safetensors.index.json')));
 assert.equal(profiles[2].fileBytesRead,0);assert.equal(profiles[3].fileBytesRead,0);
 assert.equal(profiles[4].fileBytesRead,3072);assert.equal(profiles[5].fileBytesRead,7077888);
 assert.equal(stale,2);assert.equal(loads.length,4);
 client.release();assert.equal(releases.at(-1).residentModels,0);
 console.log(JSON.stringify({parts:2,gpuCalls:successful,valuesCompared:3*(768+2304),maxError,staleRecoveries:stale,loads,pressure:pressureReply,profiles,releasedAll:true},null,2));
}finally{r.dispose();closeRamGpu();}
