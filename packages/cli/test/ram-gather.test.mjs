import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Interpreter,compileRam} from '@arrrank/interpreter';
const source='use ml\narg W .f32 shape 4 3\narg T .i32 shape 3\nreturn W T';
function run(tokens){let calls=0;const r=new Interpreter(undefined,{loadModule:()=>({id:'embed.ram',source}),ramGpu:(g,input)=>{calls++;assert.deepEqual(input.slice(-3),[2,0,2]);assert.equal(g.inputs[1].dtype,'i32');assert.equal(g.inputs[1].indexLimit,4);return [6,7,8,0,1,2,6,7,8];}});try{return {value:r.execute(`use "embed.ram"\nW = array shape 4 3 fill 0.5\nT = ${tokens}\nW embed T`),calls};}finally{r.dispose();}}
test('runtime integer indices keep duplicates and order in gather shape',()=>{assert.deepEqual(run('array 2 0 2').value.items,[6,7,8,0,1,2,6,7,8]);});
test('bad index domains reject before a native invocation',()=>{
 for(const tokens of ['array -1 0 2','array 4 0 2','array 2147483648 0 2','array 2.0 0.0 2.0','array 1.5 0.0 2.0'])assert.throws(()=>run(tokens),/gather index|32-bit integers/);
});
test('integer input may be first, but arithmetic and index transformations are not accepted',()=>{
 const g=compileRam('use ml\narg T .i32 shape 2 2\narg W .f32 shape 4 3\nreturn W T','embed.ram').graph;
 assert.deepEqual(g.outputShape,[2,2,3]);assert.equal(g.inputs[0].indexLimit,4);
 for(const expression of ['W + T','T relu','T reshape 1 3'])assert.throws(()=>compileRam(source.replace('W T',expression),'embed.ram'),/only supported as gather indices/);
});
test('one index input used against two tables enforces the smaller bound',()=>{
 const g=compileRam('use ml\narg W .f32 shape 4 3\narg V .f32 shape 2 3\narg T .i32 shape 3\nreturn W T + V T','embed.ram').graph;assert.equal(g.inputs[2].indexLimit,2);
});
