import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Interpreter} from '@arrrank/interpreter';
import {nodeIo} from '../out/node-io.js';
import {planProjection} from '../../../scripts/mlrank-plan-projection.mjs';
function fixture(rows=5,cols=3){
 const root=mkdtempSync(join(tmpdir(),'rank-projection-')),input=join(root,'w.safetensors'),out=join(root,'program');
 const h=Buffer.from(JSON.stringify({w:{dtype:'F32',shape:[rows,cols],data_offsets:[0,rows*cols*4]}})),b=Buffer.alloc(8+h.length+rows*cols*4);b.writeBigUInt64LE(BigInt(h.length));h.copy(b,8);for(let i=0;i<rows*cols;i++)b.writeFloatLE(i+1,8+h.length+i*4);writeFileSync(input,b);
 return {root,input,out,close(){rmSync(root,{recursive:true,force:true});}};
}
test('generated program computes each output once, including a smaller final part',()=>{
 for(const [rows,budget]of [[5,24],[4,24],[1,24]]){
  const f=fixture(rows);let r;try{
   const plan=planProjection(f.input,'w',f.out,{chunkBytes:budget}),calls=[];
   r=new Interpreter(undefined,{io:nodeIo,loadModule:n=>({id:n,source:readFileSync(join(f.out,n),'utf8')}),ramGpu:(g,x,files)=>{
    assert.equal(x.length,3);assert.equal(files[0],null);const d=files[1],b=readFileSync(d.path);calls.push(d);assert.ok(d.length<=budget);
    return Array.from({length:d.shape[0]},(_,i)=>x.reduce((sum,v,j)=>sum+v*b.readFloatLE(d.offset+(i*3+j)*4),0));
   }});
   const result=r.execute(readFileSync(join(f.out,'main.ra'),'utf8'));assert.deepEqual(result.items,Array.from({length:rows},(_,i)=>4.5*i+3));
   assert.equal(calls.length,plan.gpuCalls);assert.equal(calls.reduce((n,d)=>n+d.shape[0],0),rows);
   assert.equal(existsSync(join(f.out,'projecttail.ram')),rows===5);
  }finally{r?.dispose();f.close();}
 }
});
test('budget validation and existing outputs fail without publishing partial programs',()=>{
 const f=fixture();try{
  for(const budget of [0,2,NaN,4,16*1024*1024+1]){assert.throws(()=>planProjection(f.input,'w',f.out,{chunkBytes:budget}),/budget/);assert.equal(existsSync(f.out),false);}
  planProjection(f.input,'w',f.out);const before=readFileSync(join(f.out,'main.ra'),'utf8');assert.throws(()=>planProjection(f.input,'w',f.out),/already exists/);assert.equal(readFileSync(join(f.out,'main.ra'),'utf8'),before);
 }finally{f.close();}
});
test('generated checksum prevents changed source weights from reaching GPU',()=>{
 const f=fixture();let r;try{
  planProjection(f.input,'w',f.out);const b=readFileSync(f.input);b[b.length-1]^=1;writeFileSync(f.input,b);
  r=new Interpreter(undefined,{io:nodeIo,loadModule:n=>({id:n,source:readFileSync(join(f.out,n),'utf8')}),ramGpu:()=>{throw Error('GPU must not run');}});
  assert.throws(()=>r.execute(readFileSync(join(f.out,'main.ra'),'utf8')),/checksum/);
 }finally{r?.dispose();f.close();}
});
test('planning respects computed-transpose limits even with a larger byte budget',()=>{
 const f=fixture(2049,1024);try{
  const p=planProjection(f.input,'w',f.out,{chunkBytes:16*1024*1024});assert.equal(p.rowsPerPart,1024);assert.equal(p.fullParts,2);assert.equal(p.tailRows,1);assert.equal(p.maxWeightBytes,4*1024*1024);
 }finally{f.close();}
});
test('unsupported dtypes are rejected before publishing source',()=>{
 const f=fixture();try{
  const b=readFileSync(f.input),at=b.indexOf('F32');b.write('I32',at);writeFileSync(f.input,b);
  assert.throws(()=>planProjection(f.input,'w',f.out),/F32/);assert.equal(existsSync(f.out),false);
 }finally{f.close();}
});
test('batched output placement keeps token rows distinct across full and tail parts',()=>{
 const f=fixture(5,3);let r;try{
  const p=planProjection(f.input,'w',f.out,{chunkBytes:24,tokens:3});assert.deepEqual(p.inputShape,[3,3]);assert.deepEqual(p.outputShape,[3,5]);
  r=new Interpreter(undefined,{io:nodeIo,loadModule:n=>({id:n,source:readFileSync(join(f.out,n),'utf8')}),ramGpu:(g,x,files)=>{
   const d=files[1],b=readFileSync(d.path);assert.equal(x.length,9);
   return Array.from({length:3},(_,t)=>Array.from({length:d.shape[0]},(_,i)=>x.slice(t*3,t*3+3).reduce((sum,v,j)=>sum+v*b.readFloatLE(d.offset+(i*3+j)*4),0))).flat();
  }});
  r.variables.set('X',{kind:'array',shape:[3,3],items:[1,2,3,4,5,6,-1,-2,-3]});
  const result=r.execute(readFileSync(join(f.out,'main.ra'),'utf8').replace('X = array shape 3 3 fill 0.5\n',''));
  assert.deepEqual(result.items,[14,32,50,68,86,32,77,122,167,212,-14,-32,-50,-68,-86]);
 }finally{r?.dispose();f.close();}
});
test('invalid token counts and oversized host activations fail before publication',()=>{
 const f=fixture();try{
  for(const tokens of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER]){assert.throws(()=>planProjection(f.input,'w',f.out,{tokens}),/Token count|host output/);assert.equal(existsSync(f.out),false);}
 }finally{f.close();}
 const wide=fixture(1,1024);try{assert.throws(()=>planProjection(wide.input,'w',wide.out,{tokens:1025}),/host input/);assert.equal(existsSync(wide.out),false);}finally{wide.close();}
});
