import {describe,it,expect} from 'vitest';
import {compileRam,executeRamGraph,planRamMemory,type FileTensorInput,type RamGpu} from '../src/index.js';
import {bindRamFiles} from '../src/ram-file-plan.js';
const descriptor=(shape:number[],offset=512):FileTensorInput=>({path:'/weights',revision:'v1',shape,dtype:'F32',offset,length:shape.reduce((a,b)=>a*b,1)*4,fileSize:offset+shape.reduce((a,b)=>a*b,1)*4});
const bank='use ml\narg X .f32 shape 1 1024\narg Weights .f32 shape 256 1024 1024\n';
describe('RAM file range binding',()=>{
 it('turns a GiB bank slice and reshape into a bounded native file input',()=>{
  const graph=compileRam(bank+'W = (Weights (200 till 201)) reshape 1024 1024\nreturn X matmul W','bank.ram').graph;
  const file=descriptor([256,1024,1024]);
  const result=bindRamFiles(graph,Array(1024).fill(1),[null,file]);
  expect(result.files?.filter(Boolean)).toEqual([{...file,offset:512+200*4194304,length:4194304,shape:[1024,1024]}]);
  expect(result.graph.nodes.map(n=>n.kind)).toEqual(['input','input','matmul']);
  expect(result.graph.reservationBytes).toBeLessThan(5*1024*1024);
  expect(result.input.length).toBe(1024);
 });
 it('refreshes file identity and offsets without recompiling the native model',()=>{
  const graph=compileRam(bank+'return X matmul ((Weights (0 till 1)) reshape 1024 1024)','bank.ram').graph;
  const first=bindRamFiles(graph,[],[null,descriptor([256,1024,1024])]);
  const next=bindRamFiles(graph,[],[null,{...descriptor([256,1024,1024],4096),path:'/other',revision:'v2'}]);
  expect(next.graph).toBe(first.graph);expect(next.files?.[1]).toMatchObject({path:'/other',revision:'v2',offset:4096});
 });
 it('preserves nested contiguous slices but leaves strided selections on the GPU',()=>{
  const prefix='use ml\narg W .f32 shape 4 3 2\n';
  const file=descriptor([4,3,2]);
  const nested=compileRam(prefix+'A = W (1 till 4)\nB = A (1 till 2)\nreturn B relu','slice.ram').graph;
  expect(bindRamFiles(nested,[],[file]).files?.[0]).toMatchObject({offset:512+12*4,length:24,shape:[1,3,2]});
  const strided=compileRam(prefix+'return (W # (0 till 1)) relu','slice.ram').graph;
  const result=bindRamFiles(strided,[],[file]);
  expect(result.graph.nodes.some(n=>n.kind==='slice')).toBe(true);expect(result.files?.[0]).toEqual(file);
 });
 it('never treats transpose or arithmetic as a contiguous file view',()=>{
  for(const body of ['A = W transpose\nreturn (A (0 till 1)) relu','A = W + W\nreturn (A (0 till 1)) relu']){
   const graph=compileRam('use ml\narg W .f32 shape 2 3\n'+body,'computed.ram').graph;
   const result=bindRamFiles(graph,[],[descriptor([2,3])]);
   expect(result.files?.[0]).toMatchObject({offset:512,length:24});expect(result.graph.nodes.some(n=>n.kind==='slice')).toBe(true);
  }
 });
 it('preserves caller state and inline input order alongside projected file ranges',()=>{
  const source='use ml\narg X .f32 shape 1 2\narg W .f32 shape 3 2 2\narg B .f32 shape 2\nreturn (X matmul ((W (1 till 2)) reshape 2 2)) + B';
  const result=bindRamFiles(compileRam(source,'mix.ram').graph,[3,4],[null,descriptor([3,2,2]),null],{inputStates:['borrowed',null,null],retainOutput:true});
  expect(result.input).toEqual([3,4]);expect(result.options?.inputStates?.filter(Boolean)).toEqual(['borrowed']);expect(result.options?.retainOutput).toBe(true);
 });
 it('keeps a GPU output operation for pure file-view results',()=>{
  const graph=compileRam('use ml\narg W .f32 shape 3 2\nreturn W (1 till 2)','view.ram').graph;
  const result=bindRamFiles(graph,[],[descriptor([3,2])]);
  expect(result.graph.nodes.map(n=>n.kind)).toEqual(['input','reshape']);expect(result.graph.outputShape).toEqual([1,2]);
 });
 it('rejects whole oversized ranges and malformed metadata before host mutation',()=>{
  const graph=compileRam(bank+'return X matmul ((Weights (0 till 1)) reshape 1024 1024)','bank.ram').graph;
  let called=false;const gpu:RamGpu=()=>{called=true;return [];};
  expect(()=>executeRamGraph(graph,gpu,[],[null,{...descriptor([256,1024,1024]),length:4}])).toThrow('descriptor');expect(called).toBe(false);
  const large=compileRam('use ml\narg X .f32 shape 1 1024\narg W .f32 shape 1024 8192\nreturn X matmul W','large.ram').graph;
  expect(()=>executeRamGraph(large,gpu,[],[null,descriptor([1024,8192])])).toThrow('16 MiB');expect(called).toBe(false);
 });
 it('shares equal part models across distinct file ranges under the memory budget',()=>{
  let source=bank+'gpu X block W\nM = W reshape 1024 1024\nY = X matmul M\nreturn X + Y\nend\n';
  for(let i=0;i<32;i++)source+=`X = X block (Weights (${i} till ${i+1}))\n`;
  source+='return X';
  const graph=bindRamFiles(compileRam(source,'chain.ram').graph,[],[null,descriptor([256,1024,1024])]).graph;
  const plan=planRamMemory(graph,16*1024*1024,64);
  expect(plan.parts!.length).toBeGreaterThan(1);
  expect(new Set(plan.parts!.map(p=>p.graph)).size).toBeLessThan(plan.parts!.length);
  expect(plan.memoryPlan!.peakBytes).toBeLessThanOrEqual(16*1024*1024);
 });
});
