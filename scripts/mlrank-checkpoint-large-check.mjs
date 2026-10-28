// Bounded checksum verification and GPU access beyond 2 GiB; sparse, not an LLM.
import {mkdtempSync,writeFileSync,openSync,writeSync,ftruncateSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Interpreter} from '../packages/interpreter/out/index.js';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {nodeRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const directory=mkdtempSync(join(tmpdir(),'rank-large-checkpoint-')),padding=2**31+64;
const header=Buffer.from(JSON.stringify({padding:{dtype:'U8',shape:[padding],data_offsets:[0,padding]},weight:{dtype:'F32',shape:[2],data_offsets:[padding,padding+8]}}));
const prefix=Buffer.alloc(8+header.length);prefix.writeBigUInt64LE(BigInt(header.length));header.copy(prefix,8);
const tail=Buffer.alloc(8);tail.writeFloatLE(1.25);tail.writeFloatLE(-2.5,4);
const size=prefix.length+padding+8,path=join(directory,'large.safetensors'),fd=openSync(path,'wx');
try{writeSync(fd,prefix);ftruncateSync(fd,size);writeSync(fd,tail,0,8,prefix.length+padding);}finally{closeSync(fd);}
// Independent expected digest from known bytes, without reading/materializing the sparse file.
const hash=createHash('sha256').update(prefix),zeros=Buffer.alloc(65536);
for(let left=padding;left>0;left-=zeros.length)hash.update(zeros.subarray(0,Math.min(left,zeros.length)));
const sha256=hash.update(tail).digest('hex');
const manifest=JSON.stringify({weight_map:{padding:'large.safetensors',weight:'large.safetensors'},files:{'large.safetensors':{size,sha256}}});
const locked=join(directory,'large.safetensors.index.json');writeFileSync(locked,manifest);
const pin=createHash('sha256').update(manifest).digest('hex');
const ram='use ml\narg W .f32 shape 2\nreturn W + W';
const source=path=>`use io\nuse "largegpu.ram"\nF = ${JSON.stringify(path)} open\nF verify "${pin}"\nW' = F tensor "weight"\nResult = W largegpu\nF close\nResult`;
writeFileSync(join(directory,'prefix.bin'),prefix);writeFileSync(join(directory,'tail.bin'),tail);
writeFileSync(join(directory,'fixture.json'),JSON.stringify({size,offset:prefix.length+padding,headerBytes:prefix.length,sha256,pin,ram,source:source('models/large.safetensors.index.json')}));
let jsBytes=0;const io={...nodeIo,open(...args){const h=nodeIo.open(...args),read=h.read.bind(h);h.read=n=>{if(args[0]===path)assert.ok(h.position()+n<=prefix.length,'Large payload entered JS');jsBytes+=n;return read(n);};return h;}};
const r=new Interpreter(undefined,{io,loadModule:()=>({id:'largegpu.ram',source:ram}),ramGpu:nodeRamGpu});
const started=performance.now();
try{assert.deepEqual(r.execute(source(locked)).items,[2.5,-5]);console.log(JSON.stringify({directory,size,offset:prefix.length+padding,sha256,jsBytes,elapsedMs:performance.now()-started,peakRssBytes:process.resourceUsage().maxRSS*1024,correct:true},null,2));}
finally{r.dispose();closeRamGpu();}
