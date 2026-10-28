// End-to-end .ra -> .ram -> native file input, including a tensor beyond 2 GiB.
import {mkdtempSync,readFileSync,writeFileSync,openSync,writeSync,ftruncateSync,closeSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {Interpreter,compileRam} from '../packages/interpreter/out/index.js';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {nodeRamGpu,sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const directory=mkdtempSync(join(tmpdir(),'rank-file-input-'));
let values=[1,-2,3,4,5,6];
if(process.argv[2] && process.argv[2]!=='--compile-only') {
    const bytes=readFileSync(process.argv[2]), start=8+Number(bytes.readBigUInt64LE());
    const header=JSON.parse(bytes.subarray(8,start).toString());
    const t=header['h.0.ln_1.weight']; assert.equal(t.dtype,'F32');
    values=Array.from({length:t.shape[0]},(_,i)=>bytes.readFloatLE(start+t.data_offsets[0]+i*4));
}
const padding=2**31+64,header=Buffer.from(JSON.stringify({padding:{dtype:'U8',shape:[padding],data_offsets:[0,padding]},
    weight:{dtype:'F32',shape:[values.length],data_offsets:[padding,padding+values.length*4]}}));
const prefix=Buffer.alloc(8+header.length);prefix.writeBigUInt64LE(BigInt(header.length));header.copy(prefix,8);
const payload=Buffer.alloc(values.length*4);values.forEach((v,i)=>payload.writeFloatLE(v,i*4));
const offset=prefix.length+padding,path=join(directory,'input.safetensors'),fd=openSync(path,'wx');
try{writeSync(fd,prefix);ftruncateSync(fd,offset+payload.length);writeSync(fd,payload,0,payload.length,offset);}finally{closeSync(fd);}
writeFileSync(join(directory,'prefix.bin'),prefix);writeFileSync(join(directory,'payload.bin'),payload);
const ram=`use ml\narg X .f32 shape ${values.length}\nreturn X + X\n`;
const source=`use io\nuse "mapped.ram"\nF = ${JSON.stringify(path)} open\nW' = F tensor "weight"\nResult = W mapped\nF close\nResult`;
let jsBytes=0,inputDescriptor;
const io={...nodeIo,open(...args){const h=nodeIo.open(...args),r=h.read.bind(h);h.read=count=>{
    assert.ok(h.position()+count<=prefix.length,'Payload read into JavaScript');jsBytes+=count;return r(count);
};return h;}};
const graph=compileRam(ram,'mapped.ram').graph;
const model=Buffer.from(graph.model).toString('base64');
const expected=values.map(v=>Math.fround(v*2));
const fixture={ram,model,offset,fileSize:statSync(path).size,headerBytes:prefix.length,expected,directory};
writeFileSync(join(directory,'fixture.json'),JSON.stringify(fixture));
if(!process.argv.includes('--compile-only')) {
    const interpreter=new Interpreter(undefined,{io,loadModule:()=>({id:'mapped.ram',source:ram}),ramGpu:(g,input,files)=>{
        assert.deepEqual(input,[]);assert.equal(files.length,1);inputDescriptor=files[0];return nodeRamGpu(g,input,files);
    }});
    try {
        for(let run=0;run<2;run++) assert.deepEqual(interpreter.execute(run ? source.replace('use "mapped.ram"\n', '') : source).items,expected);
        assert.equal(jsBytes,2*prefix.length);
        const loaded=sendRamGpu({action:'load',model,inputSizes:[values.length]});assert.ok(loaded.modelId,loaded.error);
        for(const [change,pattern] of [[{revision:'stale'},/changed/],[{offset:fixture.fileSize},/descriptor/],[{dtype:'F16'},/descriptor/]]) {
            const reply=sendRamGpu({action:'invoke',modelId:loaded.modelId,input:[],inputFiles:[{...inputDescriptor,...change}],outputSize:values.length});
            assert.match(reply.error,pattern);
        }
        const recovered=sendRamGpu({action:'invoke',modelId:loaded.modelId,input:[],inputFiles:[inputDescriptor],outputSize:values.length});assert.deepEqual(recovered.output,expected);
        console.log(JSON.stringify({fileSize:fixture.fileSize,offset,headerBytes:prefix.length,jsBytesForTwoCalls:jsBytes,
            inputValuesSerialized:0,descriptorBytes:JSON.stringify(inputDescriptor).length,elements:values.length,gpuCalls:3,
            maxError:0,fullyAccelerated:loaded.fullyAccelerated,staleRejected:true,rangeRejected:true,dtypeRejected:true,directory},null,2));
    } finally{interpreter.dispose();closeRamGpu();}
} else console.log(JSON.stringify(fixture,null,2));
