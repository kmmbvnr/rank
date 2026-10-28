import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,openSync,writeSync,closeSync,ftruncateSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Interpreter} from '@arrrank/interpreter';
import {nodeIo} from '../out/node-io.js';
function fixture(shape=[4,3],padding=0,noPayload=false){
 const root=mkdtempSync(join(tmpdir(),'rank-slices-')),path=join(root,'w.safetensors'),count=shape.reduce((a,b)=>a*b,1);
 const meta={...(padding?{padding:{dtype:'U8',shape:[padding],data_offsets:[0,padding]}}:{}),w:{dtype:'F32',shape,data_offsets:[padding,padding+count*4]}};
 const header=Buffer.from(JSON.stringify(meta)),prefix=Buffer.alloc(8);prefix.writeBigUInt64LE(BigInt(header.length));const offset=8+header.length+padding;
 const fd=openSync(path,'wx');try{writeSync(fd,prefix);writeSync(fd,header);ftruncateSync(fd,offset+count*4);if(!noPayload){const b=Buffer.alloc(count*4);for(let i=0;i<count;i++)b.writeFloatLE(i+0.5,i*4);writeSync(fd,b,0,b.length,offset);}}finally{closeSync(fd);}
 let payloadReads=0;const calls=[];
 const io={...nodeIo,open(...args){const h=nodeIo.open(...args),read=h.read.bind(h);h.read=n=>{if(h.position()+n>8+header.length){payloadReads++;if(noPayload)throw Error('Payload entered JS');}return read(n);};return h;}};
 const r=new Interpreter(undefined,{io,loadModule:name=>{const dims=name==='row.ram'?[3]:name==='block.ram'?[2,3]:name==='large.ram'?[2048,1024]:[4,2];return {id:name,source:`use ml\narg X .f32 shape ${dims.join(' ')}\nreturn ${name==='large.ram'?'X (0 till 1) #':'X'} relu`};},ramGpu:(g,input,files)=>{calls.push({input,files});return Array(g.outputShape.reduce((a,b)=>a*b,1)).fill(0);}});
 return {r,path,offset,calls,reads:()=>payloadReads,close(){r.dispose();rmSync(root,{recursive:true});}};
}
test('nested row ranges and single rows preserve byte offsets without reading weights',()=>{
 const f=fixture();try{
  f.r.execute(`use io\nuse "block.ram"\nuse "row.ram"\nF = "${f.path}" open\nW' = F tensor "w"\nA' = W (1 till 4) #\nB' = A (1 till 3) #\nY = B block\nR' = B 1 #\nR row`);
  assert.equal(f.reads(),0);assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0].input,[]);
  assert.equal(f.calls[0].files[0].offset,f.offset+24);assert.equal(f.calls[0].files[0].length,24);assert.deepEqual(f.calls[0].files[0].shape,[2,3]);
  assert.equal(f.calls[1].files[0].offset,f.offset+36);assert.equal(f.calls[1].files[0].length,12);
 }finally{f.close();}
});
test('noncontiguous columns and arithmetic keep ordinary materialization semantics',()=>{
 const f=fixture();try{
  f.r.execute(`use io\nuse "cols.ram"\nF = "${f.path}" open\nW' = F tensor "w"\nA' = W # (0 till 2)\nFirst = A cols\nuse "block.ram"\nB' = W (0 till 2) # + 1.0\nB block`);
  assert.equal(f.calls[0].files,undefined);assert.deepEqual(f.calls[0].input,[0.5,1.5,3.5,4.5,6.5,7.5,9.5,10.5]);assert.ok(f.reads()>0);
  assert.equal(f.calls[1].files,undefined);assert.deepEqual(f.calls[1].input,[1.5,2.5,3.5,4.5,5.5,6.5]);
 }finally{f.close();}
});
test('closing a file invalidates nested deferred slices before GPU submission',()=>{
 const f=fixture();try{assert.throws(()=>f.r.execute(`use io\nuse "block.ram"\nF = "${f.path}" open\nW' = F tensor "w"\nB' = W (1 till 3) #\nF close\nB block`),/closed/i);assert.equal(f.calls.length,0);}finally{f.close();}
});
test('a 32 MiB tensor supplies 8 MiB slices beyond 2 GiB without JS payload reads',()=>{
 const f=fixture([8192,1024],2**31+64,true);try{
  f.r.execute(`use io\nuse "large.ram"\nF = "${f.path}" open\nW' = F tensor "w"\nfor Start in 0 till 8192 by 2048\nPart' = W (Start till (Start + 2048)) #\nY = Part large\nend\nF close\n0`);
  assert.equal(f.calls.length,4);assert.equal(f.reads(),0);
  f.calls.forEach((c,i)=>{assert.deepEqual(c.input,[]);assert.equal(c.files[0].offset,f.offset+i*8*1024*1024);assert.equal(c.files[0].length,8*1024*1024);});
 }finally{f.close();}
});
test('deferred file slices retain the language read-only dependency guard',()=>{
 const f=fixture();try{
  assert.throws(()=>f.r.execute(`use io\nuse "block.ram"\nF = "${f.path}" open\nW' = F tensor "w"\nB' = W (1 till 3) #\nFirst = B block\nW 1 0 = 99.0\nB block`),/read-only/);
  assert.equal(f.calls.length,0);
 }finally{f.close();}
});
