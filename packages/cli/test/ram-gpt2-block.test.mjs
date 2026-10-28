import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileRam} from '@arrrank/interpreter';

test('real GPT-2 block modules fit existing limits and keep large weights as runtime inputs',()=>{
 const expected={gpt2embed:4,gpt2attn:7,gpt2mlp:7,gpt2norm:3};
 for(const [name,inputs] of Object.entries(expected)){
  const source=readFileSync(new URL(`../../../demos/mlrank/${name}.ram`,import.meta.url),'utf8');
  const graph=compileRam(source,name+'.ram').graph;
  assert.deepEqual(graph.outputShape,[4,768]);
  assert.equal(graph.inputs.length,inputs);
  assert.ok(graph.nodes.length<=128);
  assert.ok(graph.model.length<16384,'Weights must not be baked into the graph');
 }
});

test('full vocabulary uses row embeddings and bounded full/tail LM-head graphs',()=>{
 for(const [name,shape] of [['gpt2row',[1,768]],['gpt2head',[4,1024]],['gpt2tail',[4,81]]]){
  const source=readFileSync(new URL(`../../../demos/mlrank/${name}.ram`,import.meta.url),'utf8');
  const graph=compileRam(source,name+'.ram').graph;
  assert.deepEqual(graph.outputShape,shape);
  assert.equal(graph.inputs.length,2);
  assert.ok(graph.nodes.length<=128);
  assert.ok(graph.model.length<16384);
  assert.ok(graph.reservationBytes<128*1024*1024);
 }
});
