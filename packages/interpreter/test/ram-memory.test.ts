import {describe,it,expect} from 'vitest';
import {compileRam,planRamMemory,executeRamGraph,createRamClient,type RamGpu} from '../src/index.js';
const source='use ml\narg X .f32 shape 64 64\n'+'X = X relu\n'.repeat(40)+'return X';
describe('RAM memory admission',()=>{
 it('partitions below 128 nodes when tensors exceed the byte budget',()=>{
  const graph=compileRam(source,'memory.ram').graph;
  expect(graph.parts).toBeUndefined();
  const plan=planRamMemory(graph,256*1024,64,true);
  expect(plan.parts!.length).toBeGreaterThan(1);
  expect(plan.memoryPlan!.peakBytes).toBeLessThanOrEqual(256*1024);
  expect(plan.memoryPlan!.peakStateBytes).toBe(2*64*64*4);
  expect(plan.memoryPlan!.peakStates).toBe(2);
 });
 it('accounts for output retention and validates budget and state slots',()=>{
  const graph=compileRam('use ml\narg X .f32 shape 2\nreturn X relu','small.ram').graph;
  expect(planRamMemory(graph,graph.reservationBytes,0).parts).toBeUndefined();
  expect(()=>planRamMemory(graph,graph.reservationBytes,0,true)).toThrow('state slots');
  expect(()=>planRamMemory(graph,1,64)).toThrow('cannot fit');
  for(const budget of [0,-1,NaN,Infinity])expect(()=>planRamMemory(graph,budget,64)).toThrow('budget');
 });
 it('accounts for baked and transposed linear weights',()=>{
  const graph=compileRam('use ml\narg X .f32 shape 1 64\narg W .f32 shape 64 64 = array shape 64 64 fill 0.01\n'+'X = X W linear\n'.repeat(12)+'return X','weight.ram').graph;
  const plan=planRamMemory(graph,128*1024,64);
  expect(plan.memoryPlan!.peakBytes).toBeLessThanOrEqual(128*1024);
  expect(()=>planRamMemory(graph,16*1024,64)).toThrow('cannot fit');
 });
 it('replans after unrelated state pressure and admits before GPU mutation',()=>{
  const graph=compileRam(source,'memory.ram').graph;
  let available=256*1024,invokes=0,next=0;
  const states=new Map<string,number>(),seen:object[]=[];
  const gpu:RamGpu=(g,_input,_files,options)=>{
   invokes++;seen.push(g);
   const retained=[...states.values()].reduce((a,b)=>a+b,0)+(options?.retainOutput?16384:0);
   expect(g.reservationBytes+retained).toBeLessThanOrEqual(available);
   if(options?.retainOutput){const id=String(++next);states.set(id,16384);return {id,shape:[64,64],dtype:'f32'};}
   return Array(4096).fill(1);
  };
  gpu.control=r=>{states.delete(r.stateId);return {};};
  gpu.memory=()=>({memoryBudgetBytes:1024*1024,stateBytes:1024*1024-available,residentStates:1,maxStates:64});
  executeRamGraph(graph,gpu,Array(4096).fill(1));expect(states.size).toBe(0);
  const first=[...seen];seen.length=0;executeRamGraph(graph,gpu,Array(4096).fill(1));expect(seen[0]).toBe(first[0]);
  available=128*1024;seen.length=0;executeRamGraph(graph,gpu,Array(4096).fill(1));expect(seen.length).toBeGreaterThan(first.length);expect(states.size).toBe(0);
  const before=invokes;available=1;expect(()=>executeRamGraph(graph,gpu,Array(4096).fill(1))).toThrow('cannot fit');expect(invokes).toBe(before);
 });
 it('keeps a small native model identity across changing memory pressure',()=>{
  const graph=compileRam('use ml\narg X .f32 shape 2\nreturn X relu','small.ram').graph;
  const seen:object[]=[];let stateBytes=0;
  const gpu:RamGpu=(g)=>{seen.push(g);return [1,2];};
  gpu.memory=()=>({memoryBudgetBytes:1024*1024,stateBytes,residentStates:0,maxStates:64});
  executeRamGraph(graph,gpu,[1,2]);stateBytes=1024;executeRamGraph(graph,gpu,[1,2]);
  expect(seen).toEqual([graph,graph]);expect(seen[0]).toBe(seen[1]);
 });
 it('rejects malformed native status without treating it as GPU output',()=>{
  const status={memoryBudgetBytes:128*1024*1024,stateBytes:1024,residentStates:1,maxStates:64};
  expect(createRamClient(r=>{expect(r.action).toBe('status');return status;}).memory()).toEqual(status);
  for(const bad of [{},{...status,stateBytes:-1},{...status,residentStates:65},{...status,memoryBudgetBytes:NaN}])expect(()=>createRamClient(()=>bad).memory()).toThrow('Invalid RAM memory');
 });
});
