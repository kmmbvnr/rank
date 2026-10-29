import {describe,it,expect} from 'vitest';
import {compileRam,Interpreter} from '../src/index.js';

const boundary='use ml\narg X .f32 shape 2 3\narg W .f32 shape 3 4\narg B .f32 shape 4\n';
const dense='gpu A dense Weight Bias\nH = A matmul Weight\nreturn H + Bias\nend\n';
describe('RAM local tensor functions',()=>{
 it('requires gpu declarations in RAM and keeps fun in ordinary Rank',()=>{
  expect(()=>compileRam(boundary+'fun A activate = A relu\nreturn X activate','bad.ram')).toThrow('declared with gpu');
  const r=new Interpreter();
  try{expect(r.execute('fun X twice = X + X\n3 twice')).toBe(6n);
   expect(()=>r.execute('gpu X twice = X + X')).toThrow('inside a .ram');
  }finally{r.dispose();}
 });
 it('infers helper shapes and emits the same graph as inline operations',()=>{
  const source=boundary+dense+'return X dense W B';
  const flat=compileRam(boundary+'H = X matmul W\nreturn H + B','dense.ram');
  const composed=compileRam(source,'dense.ram');
  expect(composed.graph.nodes).toEqual(flat.graph.nodes);
  expect(composed.graph.model).toEqual(flat.graph.model);
  expect(composed.graph.outputShape).toEqual([2,4]);
 });
 it('supports helpers before inputs, nested calls and multiple specializations',()=>{
  const helper='gpu A twice\nreturn A + A\nend\ngpu A positive\nB = A relu\nreturn B twice\nend\n';
  const source='use ml\n'+helper+'arg X .f32 shape 2 3\narg Y .f32 shape 3\nA = X positive\nB = Y positive\nreturn A + B';
  const flat='use ml\narg X .f32 shape 2 3\narg Y .f32 shape 3\nT = X relu\nA = T + T\nU = Y relu\nB = U + U\nreturn A + B';
  expect(compileRam(source,'multi.ram').graph.model).toEqual(compileRam(flat,'multi.ram').graph.model);
 });
 it('evaluates arguments once and keeps local assignments private',()=>{
  const source='use ml\narg X .f32 shape 2 3\nSaved = X\ngpu A twice\nSaved = A + A\nreturn Saved\nend\nH = (X relu) twice\nreturn H + Saved';
  const graph=compileRam(source,'local.ram').graph;
  expect(graph.nodes.filter(n=>n.kind==='relu')).toHaveLength(1);
  expect(graph.model).toEqual(compileRam('use ml\narg X .f32 shape 2 3\nA = X relu\nH = A + A\nreturn H + X','local.ram').graph.model);
 });
 it('resolves free tensors from the module rather than the caller',()=>{
  const source='use ml\narg X .f32 shape 2 3\nGlobal = X\ngpu A inner\nreturn A + Global\nend\ngpu A outer\nGlobal = A relu\nreturn Global inner\nend\nreturn X outer';
  expect(compileRam(source,'lexical.ram').graph.model).toEqual(compileRam('use ml\narg X .f32 shape 2 3\nH = X relu\nreturn H + X','lexical.ram').graph.model);
 });
 it('passes integer index inputs through helpers and preserves gather bounds',()=>{
  const source='use ml\narg Table .f32 shape 5 3\narg Ids .i32 shape 2\ngpu Values lookup Indices\nreturn Values Indices\nend\nreturn Table lookup Ids';
  const graph=compileRam(source,'embed.ram').graph;
  expect(graph.outputShape).toEqual([2,3]);
  expect(graph.inputs[1].indexLimit).toBe(5);
  expect(graph.nodes.at(-1)).toMatchObject({kind:'gather',left:0,right:1});
 });
 it('invokes the GPU once and recompiles edits inside the helper',()=>{
  let source='use ml\narg X .f32 shape 2\ngpu A activate\nreturn A relu\nend\nreturn X activate';
  const graphs:Uint8Array[]=[];
  const r=new Interpreter(undefined,{loadModule:n=>({id:n,source}),ramGpu:(g,input)=>{graphs.push(g.model);return input;}});
  try{
   r.execute('use "network.ram"\n(array 1.0 2.0) network');
   source=source.replace('A relu','A softmax');
   r.execute('(array 1.0 2.0) network');
   expect(graphs).toHaveLength(2);expect(graphs[0]).not.toEqual(graphs[1]);
  }finally{r.dispose();}
 });
 it('supports expression bodies, prefix calls and the existing f16 subset',()=>{
  for(const body of ['gpu A activate = A relu\nreturn X activate','gpu activate A\nreturn A relu\nend\nreturn activate X']){
   const source='use ml\narg X .f16 shape 2\n'+body;
   expect(compileRam(source,'helpernet.ram').graph.model).toEqual(compileRam('use ml\narg X .f16 shape 2\nreturn X relu','helpernet.ram').graph.model);
  }
 });
 it('diagnoses recursive call cycles rather than recursing in the compiler',()=>{
  const source='use ml\narg X .f32 shape 2\ngpu A first\nreturn A second\nend\ngpu A second\nreturn A first\nend\nreturn X first';
  expect(()=>compileRam(source,'cycle.ram')).toThrow('Recursive RAM function');
 });
 it('rejects recursion and unsupported helper statements without host execution',()=>{
  for(const helper of [
   'gpu A looped\nreturn A looped\nend',
   'gpu A looped\nA += A\nreturn A\nend',
   'gpu A looped\nif true\nreturn A\nend\nreturn A\nend',
   'gpu A looped\narg B .f32 shape 2\nreturn A\nend',
   'gpu A looped\nreturn A\nA = A relu\nend',
  ])expect(()=>compileRam('use ml\narg X .f32 shape 2\n'+helper+'\nreturn X looped','bad.ram')).toThrow();
 });
 it('reports the faulty helper line and partitions the expanded graph',()=>{
  try{compileRam(boundary+'gpu A wrong Weight\nreturn A matmul Weight\nend\nreturn B wrong W','bad.ram');expect.fail('expected error');}
  catch(e){expect(e).toMatchObject({rankKind:'RamCompile',location:{sourceId:'bad.ram',line:6}});}
  const source='use ml\narg X .f32 shape 3\ngpu A activate\nreturn A relu\nend\n'+'X = X activate\n'.repeat(128)+'return X';
  expect(compileRam(source,'large.ram').graph.parts).toHaveLength(2);
 });
});
