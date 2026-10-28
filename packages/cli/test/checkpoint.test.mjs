import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Interpreter} from '../../interpreter/out/index.js';
import {nodeIo} from '../out/node-io.js';
const digest=data=>createHash('sha256').update(data).digest('hex');
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'rank-shards-')),headers=new Map();
 const files={},weight_map={};
 for(const [name,values]of [['a',[1,2]],['b',[3,4]]]){
  const header=Buffer.from(JSON.stringify({[name]:{dtype:'F32',shape:[2],data_offsets:[0,8]}})),bytes=Buffer.alloc(8+header.length+8);
  bytes.writeBigUInt64LE(BigInt(header.length));header.copy(bytes,8);values.forEach((v,i)=>bytes.writeFloatLE(v,8+header.length+i*4));
  const file=name+'.safetensors';writeFileSync(join(root,file),bytes);files[file]={size:bytes.length,sha256:digest(bytes)};weight_map[name]=file;headers.set(file,8+header.length);
 }
 const path=join(root,'model.safetensors.index.json'),manifest={metadata:{total_size:16},weight_map,files};
 const save=()=>writeFileSync(path,JSON.stringify(manifest));save();
 let hashes=0,reads=0,closed=0;const io={...nodeIo,open(...args){const h=nodeIo.open(...args),read=h.read.bind(h),hash=h.sha256.bind(h),close=h.close.bind(h);h.sha256=()=>{hashes++;return hash();};h.read=n=>{const header=headers.get(args[0].split('/').at(-1));if(header)assert.ok(h.position()+n<=header,'Payload read into JS');reads+=n;return read(n);};h.close=()=>{closed++;close();};return h;}};
 const calls=[];const r=new Interpreter(undefined,{io,loadModule:()=>({id:'combinegpu.ram',source:'use ml\narg A .f32 shape 2\narg B .f32 shape 2\nreturn A + B'}),ramGpu:(g,input,files)=>{calls.push({input,files});return [4,6];}});
 return {root,path,manifest,save,r,calls,io,hashes:()=>hashes,reads:()=>reads,closed:()=>closed,cleanup(){r.dispose();rmSync(root,{recursive:true});}};
}
test('checkpoint metadata reads shard headers without hashing payloads',()=>{
 const f=fixture();try{
  const value=f.r.execute(`use io\nF = "${f.path}" open\nF safetensors`);
  assert.deepEqual(value.items.map(row=>row.entries.get('file')),['a.safetensors','b.safetensors']);assert.equal(f.hashes(),0);assert.equal(f.closed(),3);
 }finally{f.cleanup();}
});
test('locked shards preserve descriptors and hash each selected shard once per open checkpoint',()=>{
 const f=fixture();try{
  const sha=digest(readFileSync(f.path));
  const value=f.r.execute(`use io\nuse "combinegpu.ram"\nF = "${f.path}" open\nF verify "${sha}"\nA' = F tensor "a"\nB' = F tensor "b"\nFirst = A combinegpu B\nSecond = A combinegpu B\nF close\nSecond`);
  assert.deepEqual(value.items,[4,6]);assert.equal(f.hashes(),3);assert.equal(f.calls.length,2);
  for(const c of f.calls){assert.deepEqual(c.input,[]);assert.ok(c.files[0].path.endsWith('a.safetensors'));assert.ok(c.files[1].path.endsWith('b.safetensors'));}
  assert.equal(f.closed(),3);
 }finally{f.cleanup();}
});
test('missing locks, checksum failures, missing tensors and unsafe paths reject before GPU',()=>{
 for(const mode of ['unlocked','checksum','missing','path','duplicate']){
  const f=fixture();try{
   if(mode==='unlocked')delete f.manifest.files;
   if(mode==='checksum')f.manifest.files['a.safetensors'].sha256='0'.repeat(64);
   if(mode==='missing'){f.manifest.weight_map.absent='a.safetensors';delete f.manifest.weight_map.a;}
   if(mode==='path')f.manifest.weight_map.a='../a.safetensors';
   f.save();if(mode==='duplicate')writeFileSync(f.path,'{"weight_map":{"a":"a.safetensors","a":"b.safetensors"}}');
   assert.throws(()=>f.r.execute(`use io\nuse "combinegpu.ram"\nF = "${f.path}" open\nA' = F tensor "a"\nA combinegpu A`),{unlocked:/locked/,checksum:/checksum/,missing:/unknown tensor|tensor names/,path:/sibling/,duplicate:/duplicate/}[mode]);assert.equal(f.calls.length,0);
  }finally{f.cleanup();}
 }
});
test('closing the parent invalidates deferred shard views',()=>{
 const f=fixture();try{
  assert.throws(()=>f.r.execute(`use io\nuse "combinegpu.ram"\nF = "${f.path}" open\nA' = F tensor "a"\nFirst = A combinegpu A\nF close\nA combinegpu A`),/closed/i);assert.equal(f.calls.length,1);
 }finally{f.cleanup();}
});
test('locking an existing index seals the same files without copying weights',()=>{
 const f=fixture();try{
  delete f.manifest.files;f.save();const out=join(f.root,'locked.safetensors.index.json');
  const report=JSON.parse(execFileSync(process.execPath,['scripts/mlrank-lock-checkpoint.mjs',f.path,out],{cwd:new URL('../../../',import.meta.url),encoding:'utf8'}));
  assert.equal(report.shards,2);assert.equal(report.sha256,digest(readFileSync(out)));assert.ok(statSync(out).size<1024);
  const locked=JSON.parse(readFileSync(out));assert.equal(locked.files['a.safetensors'].sha256,digest(readFileSync(join(f.root,'a.safetensors'))));
 }finally{f.cleanup();}
});

test('changes to an opened index or verified shard are rejected before a second GPU call',()=>{
 for(const changed of ['index','shard']){
  const f=fixture();try{
   // Mutate on the first native invocation, while both deferred inputs are alive.
   const r=new Interpreter(undefined,{io:f.io,loadModule:()=>({id:'combinegpu.ram',source:'use ml\narg A .f32 shape 2\narg B .f32 shape 2\nreturn A + B'}),ramGpu:()=>{
    f.calls.push({});const path=changed==='index'?f.path:join(f.root,'a.safetensors');
    const bytes=readFileSync(path);bytes[bytes.length-1]^=1;writeFileSync(path,bytes);return [2,4];
   }});
   try{assert.throws(()=>r.execute(`use io\nuse "combinegpu.ram"\nF = "${f.path}" open\nA' = F tensor "a"\nFirst = A combinegpu A\nA combinegpu A`),/changed/i);assert.equal(f.calls.length,1);}finally{r.dispose();}
  }finally{f.cleanup();}
 }
});

test('checksum verification preserves cursor and rejects the wrong pinned index',()=>{
 const f=fixture();try{
  assert.throws(()=>f.r.execute(`use io\nF = "${f.path}" open\nF verify "${'0'.repeat(64)}"`),/checksum/);
  const r=new Interpreter(undefined,{io:nodeIo});try{
   const result=r.execute(`use io\nF = "${f.path}" open\nF seek 5\nF verify "${digest(readFileSync(f.path))}"\nF position`);assert.equal(result,5n);
  }finally{r.dispose();}
 }finally{f.cleanup();}
});

test('ordinary Rank can inspect selected cells across locked shards',()=>{
 const f=fixture(),r=new Interpreter(undefined,{io:nodeIo});try{
  const result=r.execute(`use io\nF = "${f.path}" open\nA' = F tensor "a"\nB' = F tensor "b"\nResult = (A 0) + (B 1)\nF close\nResult`);
  assert.equal(result,5);
 }finally{r.dispose();f.cleanup();}
});
