import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {compileRam,executeRamGraph,planRamMemory} from '../packages/interpreter/out/index.js';
import {nodeRamGpu,sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const source='use ml\narg X .f32 shape 64 64\n'+'X = X relu\n'.repeat(40)+'return X';
const graph=compileRam(source,'memory.ram').graph,input=Array.from({length:4096},(_,i)=>Math.fround(Math.sin(i))),checks=[];
if(process.argv.includes('--fixture')){
 const make=n=>compileRam(`use ml\narg X .f32 shape ${n} ${n}\nreturn X relu`,'pressure.ram').graph;
 const encode=g=>({model:Buffer.from(g.model).toString('base64'),reservationBytes:g.reservationBytes,inputSizes:g.inputs.map(i=>i.shape.reduce((a,b)=>a*b,1)),inputNames:['t0'],outputName:'t1'});
 const fixture={pressure:encode(make(1024)),small:encode(make(1)),source:'use ml\narg X .f32 shape 256 256\n'+'X = X relu\n'.repeat(100)+'return X'};
 mkdirSync('/tmp/rank-mlrank',{recursive:true});writeFileSync('/tmp/rank-mlrank/memory-android-fixture.json',JSON.stringify(fixture));process.exit();
}
try{
 for(const cap of [256*1024,128*1024,256*1024]){
  let calls=0,peakWorkingBytes=0;const plan=planRamMemory(graph,cap,64);
  const gpu=(g,data,files,options)=>{
   const before=sendRamGpu({action:'status'});
   const working=g.reservationBytes+before.stateBytes+(options?.retainOutput?g.outputShape.reduce((a,b)=>a*b,1)*4:0);
   peakWorkingBytes=Math.max(peakWorkingBytes,working);assert.ok(working<=cap);calls++;
   return nodeRamGpu(g,data,files,options);
  };gpu.control=nodeRamGpu.control;gpu.memory=()=>({...nodeRamGpu.memory(),memoryBudgetBytes:cap});
  const start=performance.now(),output=executeRamGraph(graph,gpu,input),wallMs=performance.now()-start;
  assert.deepEqual(output,input.map(v=>Math.max(0,v)));
  assert.equal(calls,plan.parts?.length??1);const status=sendRamGpu({action:'status'});assert.equal(status.stateBytes,0);
  checks.push({cap,parts:calls,peakWorkingBytes,plan:plan.memoryPlan,wallMs,finalStateBytes:status.stateBytes});
 }
 let invoked=false;const tiny=(...args)=>{invoked=true;return nodeRamGpu(...args);};tiny.control=nodeRamGpu.control;tiny.memory=()=>({...nodeRamGpu.memory(),memoryBudgetBytes:1});
 assert.throws(()=>executeRamGraph(graph,tiny,input),/cannot fit/);assert.equal(invoked,false);
 // Deliberately conservative reservations fill the native cache without allocating
 // large test tensors. Retention must evict an inactive model, never a live state.
 const small=compileRam('use ml\narg X .f32 shape 2\nreturn X relu','small.ram').graph;
 const load=()=>sendRamGpu({action:'load',model:Buffer.from(small.model).toString('base64'),reservationBytes:64*1024*1024,inputSizes:[2],inputNames:['t0'],outputName:'t1'});
 const a=load(),b=load();assert.ok(a.modelId&&b.modelId);
 const retained=sendRamGpu({action:'invoke',modelId:b.modelId,input:[-1,2],outputSize:2,retainOutput:true});
 assert.ok(retained.state,JSON.stringify(retained));assert.equal(retained.residentModels,1);assert.equal(retained.stateBytes,8);
 assert.deepEqual(sendRamGpu({action:'readState',stateId:retained.state.id}).output,[0,2]);
 sendRamGpu({action:'releaseState',stateId:retained.state.id});sendRamGpu({action:'release',modelId:b.modelId});
 const final=sendRamGpu({action:'status'});assert.equal(final.stateBytes,0);
 console.log(JSON.stringify({platform:process.platform,checks,tooSmallRejectedBeforeInvoke:true,retentionEvictedCachedModel:true,finalStateBytes:final.stateBytes},null,2));
}finally{closeRamGpu();}
