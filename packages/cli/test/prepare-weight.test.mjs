import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,readdirSync,openSync,writeSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareWeight} from '../../../scripts/mlrank-prepare-weight.mjs';
import {Interpreter} from '../../interpreter/out/index.js';
import {nodeIo} from '../out/node-io.js';
function fixture(dtype,shape,values){
 const root=mkdtempSync(join(tmpdir(),'rank-prepare-')),input=join(root,'source.safetensors'),cache=join(root,'cache');
 const width=dtype==='F32'?4:2,header=Buffer.from(JSON.stringify({w:{dtype,shape,data_offsets:[0,values.length*width]}})),bytes=Buffer.alloc(8+header.length+values.length*width);
 bytes.writeBigUInt64LE(BigInt(header.length));header.copy(bytes,8);values.forEach((v,i)=>width===4?bytes.writeFloatLE(v,8+header.length+i*4):bytes.writeUInt16LE(v,8+header.length+i*2));writeFileSync(input,bytes);
 return {root,input,cache,cleanup(){rmSync(root,{recursive:true,force:true});}};
}
function cells(path){const bytes=readFileSync(path),start=8+Number(bytes.readBigUInt64LE());return Array.from({length:(bytes.length-start)/4},(_,i)=>bytes.readFloatLE(start+i*4));}
test('F16 and BF16 conversion preserves signed zeros, subnormals and finite extremes',()=>{
 for(const [dtype,bits,expected] of [
  ['F16',[0,0x8000,1,0x3c00,0xc000,0x7bff],[0,-0,2**-24,1,-2,65504]],
  ['BF16',[0,0x8000,1,0x3f80,0xc000,0x7f7f],[0,-0,2**-133,1,-2,(2-2**-7)*2**127]],
 ]){const f=fixture(dtype,[2,3],bits);try{const result=prepareWeight(f.input,'w',f.cache);assert.deepEqual(cells(result.path),expected);assert.equal(result.cached,false);assert.equal(prepareWeight(f.input,'w',f.cache).cached,true);}finally{f.cleanup();}}
});
test('tiled transpose handles both partial edges and roundtrips exactly',()=>{
 const shape=[259,263],values=Array.from({length:259*263},(_,i)=>(i%101)-50.25),f=fixture('F32',shape,values);
 try{const t=prepareWeight(f.input,'w',f.cache,{transpose:true});assert.deepEqual(t.shape,[263,259]);assert.deepEqual(cells(t.path),Array.from({length:values.length},(_,i)=>values[(i%259)*263+Math.floor(i/259)]));assert.deepEqual(cells(prepareWeight(t.path,'w',f.cache,{transpose:true}).path),values);assert.ok(t.maxReadBytes<=1024);assert.equal(t.transformBufferBytes,262144);}finally{f.cleanup();}
});
test('prepared F32 file is readable by ordinary Rank and preserves a GPU descriptor',()=>{
 const f=fixture('F16',[2,2],[0x3c00,0x4000,0x4200,0x4400]);let r;
 try{const p=prepareWeight(f.input,'w',f.cache,{transpose:true});const calls=[];
  r=new Interpreter(undefined,{io:nodeIo,loadModule:()=>({id:'prepared.ram',source:'use ml\narg X .f32 shape 2 2\nreturn X relu'}),ramGpu:(g,input,files)=>{calls.push({input,files});return [1,3,2,4];}});
  const out=r.execute(`use io\nuse "prepared.ram"\nF = "${p.path}" open\nW' = F tensor "w"\nA = W prepared\nF close\nA`);
  assert.deepEqual(out.items,[1,3,2,4]);assert.deepEqual(calls[0].input,[]);assert.equal(calls[0].files[0].dtype,'F32');
  const viewed=r.execute(`F = "${p.path}" open\nW = F tensor "w"\nF close\nW`);assert.deepEqual(viewed.items,[1,3,2,4]);
 }finally{r?.dispose();f.cleanup();}
});
test('cache detects corruption and source changes select a new entry',()=>{
 const f=fixture('F32',[2],[1,2]);try{
  const first=prepareWeight(f.input,'w',f.cache);const bytes=readFileSync(f.input);bytes.writeFloatLE(3,bytes.length-4);writeFileSync(f.input,bytes);
  const second=prepareWeight(f.input,'w',f.cache);assert.notEqual(first.key,second.key);assert.deepEqual(cells(second.path),[1,3]);
  writeFileSync(second.path,'bad');assert.throws(()=>prepareWeight(f.input,'w',f.cache),/checksum/);
 }finally{f.cleanup();}
});
test('nonfinite weights and malformed or unsupported inputs leave no partial cache entry',()=>{
 for(const dtype of ['F32','F16','BF16']){
  const f=fixture(dtype,[1],dtype==='F32'?[Infinity]:[dtype==='F16'?0x7c00:0x7f80]);try{assert.throws(()=>prepareWeight(f.input,'w',f.cache),/finite/);assert.deepEqual(readdirSync(f.cache),[]);}finally{f.cleanup();}
 }
 const f=fixture('F32',[2],[1,2]);try{
  assert.throws(()=>prepareWeight(f.input,'w',f.cache,{transpose:true}),/matrix/);
  assert.throws(()=>prepareWeight(f.input,'missing',f.cache),/unknown tensor/);
  writeFileSync(f.input,readFileSync(f.input).subarray(0,12));assert.throws(()=>prepareWeight(f.input,'w',f.cache),/header|truncated/);
 }finally{f.cleanup();}
});
test('selected tensor beyond 2 GiB is transformed with bounded reads',()=>{
 const root=mkdtempSync(join(tmpdir(),'rank-prepare-large-'));try{
  const input=join(root,'large.safetensors'),offset=2**31+16;
  const header=Buffer.from(JSON.stringify({padding:{dtype:'U8',shape:[offset],data_offsets:[0,offset]},w:{dtype:'F16',shape:[1,2],data_offsets:[offset,offset+4]}}));
  const prefix=Buffer.alloc(8);prefix.writeBigUInt64LE(BigInt(header.length));const fd=openSync(input,'wx');
  try{writeSync(fd,prefix,0,8,0);writeSync(fd,header,0,header.length,8);writeSync(fd,Buffer.from([0,0x3c,0,0x40]),0,4,8+header.length+offset);}finally{closeSync(fd);}
  const p=prepareWeight(input,'w',join(root,'cache'),{transpose:true});assert.deepEqual(cells(p.path),[1,2]);assert.equal(p.maxReadBytes,4);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('source mutation during conversion prevents publication',()=>{
 const f=fixture('F32',[4],[1,2,3,4]),original=nodeIo.open;let mutated=false;
 try{
  nodeIo.open=(...args)=>{const h=original(...args);if(args[0]===f.input){const read=h.read.bind(h);h.read=n=>{const bytes=read(n);if(n===16&&!mutated){mutated=true;const b=readFileSync(f.input);b.writeFloatLE(9,b.length-4);writeFileSync(f.input,b);}return bytes;};}return h;};
  assert.throws(()=>prepareWeight(f.input,'w',f.cache),/changed/);assert.equal(mutated,true);assert.deepEqual(readdirSync(f.cache),[]);
 }finally{nodeIo.open=original;f.cleanup();}
});
