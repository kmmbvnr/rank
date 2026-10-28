import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,openSync,writeSync,ftruncateSync,closeSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Interpreter} from '@arrrank/interpreter';
import {nodeIo} from '../out/node-io.js';

function fixture(dtype='F32') {
    const root=mkdtempSync(join(tmpdir(),'rank-file-input-')),path=join(root,'weights.safetensors');
    const offset=2**31+64, width=dtype==='F32'?4:2;
    const header=Buffer.from(JSON.stringify({padding:{dtype:'U8',shape:[offset],data_offsets:[0,offset]},
        weight:{dtype,shape:[2,3],data_offsets:[offset,offset+6*width]}}));
    const prefix=Buffer.alloc(8);prefix.writeBigUInt64LE(BigInt(header.length));
    const fd=openSync(path,'wx');try{writeSync(fd,prefix);writeSync(fd,header);ftruncateSync(fd,8+header.length+offset+6*width);}finally{closeSync(fd);}
    let bytes=0,calls=0;
    const io={...nodeIo,open(...args){const h=nodeIo.open(...args),read=h.read.bind(h);h.read=count=>{
        assert.ok(h.position()+count<=8+header.length,'Tensor payload entered JavaScript');bytes+=count;return read(count);
    };return h;}};
    const interpreter=new Interpreter(undefined,{io,loadModule:()=>({id:'gpu.ram',source:'use ml\noption X .f32 shape 2 3\noption Y .f32 shape 2 3\nreturn X + Y'}),
        ramGpu:(graph,input,files)=>{calls++;assert.deepEqual(input,[1,1,1,1,1,1]);assert.equal(files.length,2);assert.equal(files[0].offset,8+header.length+offset);assert.equal(files[0].length,24);assert.equal(files[1],null);return [1,1,1,1,1,1];}});
    return {interpreter,path,headerBytes:8+header.length,bytes:()=>bytes,calls:()=>calls,close(){interpreter.dispose();rmSync(root,{recursive:true});}};
}

test('deferred file tensor keeps a descriptor through binding checks into a mixed RAM call',()=>{
    const f=fixture();try{
        const result=f.interpreter.execute(`use io\nuse "gpu.ram"\nF = "${f.path}" open\nW' = F tensor "weight"\nAlias' = W\nY = array shape 2 3 fill 1.0\nAlias gpu Y`);
        assert.deepEqual(result.items,[1,1,1,1,1,1]);assert.equal(f.calls(),1);assert.equal(f.bytes(),f.headerBytes);
    }finally{f.close();}
});

test('descriptor transfer preserves established binding type checks',()=>{
    const f=fixture();try{
        assert.throws(()=>f.interpreter.execute(`use io\nuse "gpu.ram"\nF = "${f.path}" open\nW' = array shape 2 3 fill 1\nObserved = W 0 0\nW' = F tensor "weight"\nY = array shape 2 3 fill 1.0\nW gpu Y`));
        assert.equal(f.calls(),0);
    }finally{f.close();}
});

test('closed files and unsupported dtypes fail before GPU or payload reads',()=>{
    for(const dtype of ['F32','F16']) {
        const f=fixture(dtype);try{
            assert.throws(()=>f.interpreter.execute(`use io\nuse "gpu.ram"\nF = "${f.path}" open\nW' = F tensor "weight"\n${dtype==='F32'?'F close\n':''}Y = array shape 2 3 fill 1.0\nW gpu Y`),dtype==='F32'?/closed/:/F32/);
            assert.equal(f.calls(),0);
        }finally{f.close();}
    }
});
