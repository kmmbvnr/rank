import {describe,it,expect} from 'vitest';
import {compileRam,executeRamGraph,Interpreter,withInterrupt,type RamGpu} from '../src/index.js';
import {ramDependencies} from '../src/ram-plan.js';
const prefix='use ml\narg X .f32 shape 2\n';
const source=prefix+'A = X relu\n'+ 'A = A relu\n'.repeat(140)+'B = A + X\n'+ 'B = B relu\n'.repeat(140)+'return A + B';
function host(failAt=Infinity) {
 const states=new Map<string,number[]>(),calls:any[]=[],released:string[]=[];let count=0,reads=0;
 const gpu:RamGpu=(g,input,files,options)=>{
  calls.push({g,input,files,options});if(++count===failAt)throw Error('injected stage failure');
  let offset=0,index=0;const values:number[][]=[];
  for(const n of g.nodes){
   if(n.kind==='input') {const state=options?.inputStates?.[index++];values.push(state?states.get(state)!:input.slice(offset,offset+=n.shape.reduce((a,b)=>a*b,1)));}
   else if(n.kind==='constant')values.push([...n.values]);
   else if(n.kind==='reshape')values.push(values[n.input]);
   else if(n.kind==='relu')values.push(values[n.input].map(v=>Math.max(0,v)));
   else if(n.kind==='add')values.push(values[n.left].map((v,j)=>v+values[n.right][j]));
   else throw Error('Unexpected operator');
  }
  const result=values[g.output];
  if(options?.retainOutput){const id='s'+count;states.set(id,result);return {id,dtype:'f32',shape:g.outputShape};}
  return result;
 };
 gpu.control=r=>{if(r.action==='readState'){reads++;return {output:states.get(r.stateId)};}released.push(r.stateId);states.delete(r.stateId);return {};};
 return {gpu,states,calls,released,reads:()=>reads};
}
describe('automatic RAM partitioning',()=>{
 it('executes branches once, retains crossing tensors and releases them at last use',()=>{
  const graph=compileRam(source,'network.ram').graph,h=host();
  expect(graph.parts!.length).toBeGreaterThan(2);
  const operations=graph.parts!.flatMap(p=>p.graph.nodes.filter(n=>n.kind!=='input'&&n.kind!=='constant'));
  expect(operations.length).toBe(graph.nodes.filter(n=>n.kind!=='input'&&n.kind!=='constant').length);
  expect(graph.parts!.every(p=>p.graph.nodes.length<=128)).toBe(true);
  expect(executeRamGraph(graph,h.gpu,[-2,3])).toEqual([0,9]);
  expect(h.states.size).toBe(0);expect(h.reads()).toBe(0);
  expect(h.calls.filter(c=>!c.options?.retainOutput)).toHaveLength(1);
  expect(h.calls.some(c=>c.options.inputStates.filter(Boolean).length===2)).toBe(true);
 });
 it('cleans every internal state after failure at any part',()=>{
  const graph=compileRam(source,'network.ram').graph;
  for(let i=1;i<=graph.parts!.length;i++){
   const h=host(i);expect(()=>executeRamGraph(graph,h.gpu,[-2,3])).toThrow('injected');expect(h.states.size).toBe(0);
  }
 });
 it('preserves borrowed states and returns only the requested retained result',()=>{
  const graph=compileRam(source,'network.ram').graph,h=host();h.states.set('borrowed',[-2,3]);
  const out=executeRamGraph(graph,h.gpu,[],undefined,{inputStates:['borrowed'],retainOutput:true});
  expect(out).toMatchObject({dtype:'f32',shape:[2]});expect(h.states.size).toBe(2);expect(h.states.has('borrowed')).toBe(true);expect(h.reads()).toBe(0);
 });
 it('routes mixed array, file and state inputs without materializing file data',()=>{
  const graph=compileRam(prefix+'arg W .f32 shape 2\narg Z .f32 shape 2\n'+'X = X relu\n'.repeat(140)+'return X + W + Z','mixed.ram').graph;
  const file={path:'/weights',revision:'test',offset:8,length:8,fileSize:16,dtype:'F32' as const,shape:[2]};
  const h=host();h.states.set('borrowed',[1,2]);
  const gpu:RamGpu=(g,data,files,options)=>{
   const all:number[]=[];let offset=0;
   g.inputs.forEach((_,i)=>{if(options?.inputStates?.[i])return;if(files?.[i])all.push(4,5);else {all.push(...data.slice(offset,offset+2));offset+=2;}});
   return h.gpu(g,all,files,options);
  };gpu.control=h.gpu.control;
  expect(executeRamGraph(graph,gpu,[-2,3],[null,file,null],{inputStates:[null,null,'borrowed']})).toEqual([5,10]);
  expect(h.calls.some(c=>c.files?.some((f:any)=>f?.path===file.path&&f.offset===file.offset&&f.length===file.length))).toBe(true);expect(h.states.size).toBe(1);
 });
 it('cleans malformed descriptors and rejects hosts without state support before invoking',()=>{
  const graph=compileRam(source,'network.ram').graph,h=host();
  const broken:RamGpu=()=>({id:'bad',dtype:'f32',shape:[9]});broken.control=h.gpu.control;
  expect(()=>executeRamGraph(graph,broken,[-2,3])).toThrow('Invalid intermediate');expect(h.released).toEqual(['bad']);
  let calls=0;expect(()=>executeRamGraph(graph,()=>{calls++;return [];},[-2,3])).toThrow('state support');expect(calls).toBe(0);
 });
 it('checks interruption between parts and cleans allocated states',()=>{
  const graph=compileRam(source,'network.ram').graph,h=host(),signal=new Int32Array(new SharedArrayBuffer(12));
  const gpu:RamGpu=(...args)=>{const out=h.gpu(...args);Atomics.store(signal,0,1);return out;};gpu.control=h.gpu.control;
  expect(()=>withInterrupt(signal,()=>executeRamGraph(graph,gpu,[-2,3]))).toThrow();expect(h.states.size).toBe(0);expect(h.calls).toHaveLength(1);
 });
 it('integrates with ordinary module calls and gpukeep ownership',()=>{
  const h=host(),r=new Interpreter(undefined,{ramGpu:h.gpu,loadModule:n=>({id:n,source})});
  try{
   expect(r.execute('use ml\nuse "network.ram"\n(array -2.0 3.0) network')).toMatchObject({items:[0,9]});
   r.execute('keep = (network gpukeep)\nS = (array -2.0 3.0) keep');expect(h.states.size).toBe(1);
  }finally{r.dispose();}expect(h.states.size).toBe(0);
 });
 it('keeps structural constants baked and every dependency topologically valid',()=>{
  const s='use ml\narg X .f32 shape 2 3\n'+'X = X layernorm\n'.repeat(30)+'return X transpose';
  const graph=compileRam(s,'norm.ram').graph;
  for(const part of graph.parts!)part.graph.nodes.forEach((n,i)=>{
   expect(ramDependencies(n).every(id=>id<i)).toBe(true);
   if(n.kind==='sum')expect(part.graph.nodes[n.right]).toMatchObject({kind:'constant',dtype:'i32'});
   if(n.kind==='transpose')expect(part.graph.nodes[n.permutation]).toMatchObject({kind:'constant',dtype:'i32'});
  });
 });
 it('keeps small models unchanged and bounds total compilation',()=>{
  expect(compileRam(prefix+'return X relu','small.ram').graph.parts).toBeUndefined();
  expect(compileRam(prefix+'X = X relu\n'.repeat(4095)+'return X','limit.ram').graph.nodes).toHaveLength(4096);
  expect(()=>compileRam(prefix+'X = X relu\n'.repeat(4096)+'return X','huge.ram')).toThrow('4096 tensors');
  expect(()=>compileRam(prefix.replace('f32','f16')+'X = X relu\n'.repeat(128)+'return X','half.ram')).toThrow('require .f32');
 });
});
