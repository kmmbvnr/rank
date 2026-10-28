// Explicit, bounded preparation of one file-backed weight. Never changes the source.
import {mkdirSync,mkdtempSync,openSync,closeSync,writeSync,readFileSync,writeFileSync,renameSync,rmSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {safetensor} from '../packages/interpreter/out/safetensors.js';
import {fileTensorInput} from '../packages/interpreter/out/file-tensor.js';

const TILE=256;
const hash=text=>createHash('sha256').update(text).digest('hex');
function checksum(path){const h=nodeIo.open(path,'read');try{return h.sha256();}finally{h.close();}}
function half(bits){
 const sign=bits&0x8000?-1:1,exponent=(bits>>10)&31,mantissa=bits&1023;
 return exponent===31?mantissa?NaN:sign*Infinity:sign*(exponent?1+mantissa/1024:mantissa/1024)*2**(exponent?exponent-15:-14);
}
export function prepareWeight(input,name,cache,{transpose=false}={}){
 const started=performance.now(),handle=nodeIo.open(resolve(input),'read');let temporary,fd;
 try{
  const revision=handle.revision(),file={kind:'file',closed:false,handle};
  const tensor=safetensor(file,name),descriptor=fileTensorInput(tensor);
  if(!descriptor||!['F32','F16','BF16'].includes(descriptor.dtype))throw Error('Preparation requires a non-scalar F32, F16 or BF16 tensor');
  if(transpose&&descriptor.shape.length!==2)throw Error('Transpose requires a matrix');
  const sourceSha256=handle.sha256();
  const unchanged=()=>{if(handle.revision()!==revision)throw Error('Source changed during preparation');};
  unchanged();
  const operation={version:1,sourceSha256,name,transpose,dtype:'F32'};
  const key=hash(JSON.stringify(operation)),directory=join(resolve(cache),key),path=join(directory,'weight.safetensors');
  const cached=()=>{
   const receiptPath=join(directory,'receipt.json');
   if(statSync(receiptPath).size>65536)throw Error('Invalid preparation receipt');
   const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
   if(receipt.key!==key||JSON.stringify(receipt.operation)!==JSON.stringify(operation)||checksum(path)!==receipt.sha256)
    throw Error('Prepared weight cache checksum mismatch');
   unchanged();return {...receipt,path,cached:true,elapsedMs:performance.now()-started,peakRssBytes:process.resourceUsage().maxRSS*1024};
  };
  try{statSync(directory);return cached();}catch(e){if(e.code!=='ENOENT')throw e;}
  mkdirSync(resolve(cache),{recursive:true});temporary=mkdtempSync(join(resolve(cache),'.prepare-'));
  const output=join(temporary,'weight.safetensors'),shape=transpose?[...descriptor.shape].reverse():descriptor.shape;
  const count=shape.reduce((a,b)=>a*b,1),length=count*4;
  if(!Number.isSafeInteger(length))throw Error('Prepared tensor exceeds safe file addressing');
  const json=JSON.stringify({[name]:{dtype:'F32',shape,data_offsets:[0,length]}});
  const header=Buffer.from(json+' '.repeat((8-Buffer.byteLength(json)%8)%8)),prefix=Buffer.alloc(8);prefix.writeBigUInt64LE(BigInt(header.length));
  fd=openSync(output,'wx');
  const write=(bytes,position)=>{let done=0;while(done<bytes.length){const n=writeSync(fd,bytes,done,bytes.length-done,position+done);if(!n)throw Error('Short output write');done+=n;}};
  write(prefix,0);write(header,8);const start=8+header.length,width=descriptor.dtype==='F32'?4:2;
  let maxReadBytes=0;
  const read=(at,n)=>{handle.seek(descriptor.offset+at*width);const b=handle.read(n*width);maxReadBytes=Math.max(maxReadBytes,b.length);if(b.length!==n*width)throw Error('Truncated weight');return new DataView(b.buffer,b.byteOffset,b.byteLength);};
  const scratch=new DataView(new ArrayBuffer(4));
  const value=(view,i)=>{
   let v;
   if(width===4)v=view.getFloat32(i*4,true);
   else if(descriptor.dtype==='F16')v=half(view.getUint16(i*2,true));
   else{scratch.setUint32(0,view.getUint16(i*2,true)*65536,true);v=scratch.getFloat32(0,true);}
   if(!Number.isFinite(v))throw Error('Prepared GPU weights require finite values');return v;
  };
  const buffer=Buffer.alloc(TILE*TILE*4);
  if(!transpose){
   for(let at=0;at<count;at+=TILE*TILE){const n=Math.min(TILE*TILE,count-at),view=read(at,n);for(let i=0;i<n;i++)buffer.writeFloatLE(value(view,i),i*4);write(buffer.subarray(0,n*4),start+at*4);}
  }else{
   const [rows,cols]=descriptor.shape;
   for(let r=0;r<rows;r+=TILE)for(let c=0;c<cols;c+=TILE){
    const nr=Math.min(TILE,rows-r),nc=Math.min(TILE,cols-c);
    for(let i=0;i<nr;i++){const view=read((r+i)*cols+c,nc);for(let j=0;j<nc;j++)buffer.writeFloatLE(value(view,j),(j*nr+i)*4);}
    for(let j=0;j<nc;j++)write(buffer.subarray(j*nr*4,(j+1)*nr*4),start+((c+j)*rows+r)*4);
   }
  }
  closeSync(fd);fd=undefined;unchanged();
  if(handle.sha256()!==sourceSha256)throw Error('Source changed during preparation');
  const receipt={key,operation,sha256:checksum(output),shape,dtype:'F32',payloadBytes:length,maxReadBytes,transformBufferBytes:buffer.length};
  writeFileSync(join(temporary,'receipt.json'),JSON.stringify(receipt)+'\n',{flag:'wx'});unchanged();
  try{renameSync(temporary,directory);temporary=undefined;}catch(e){if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;return cached();}
  return {...receipt,path,cached:false,elapsedMs:performance.now()-started,peakRssBytes:process.resourceUsage().maxRSS*1024};
 }finally{if(fd!==undefined)closeSync(fd);if(temporary)rmSync(temporary,{recursive:true,force:true});handle.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [input,name,cache,flag,...extra]=process.argv.slice(2);
 if(!input||!name||!cache||extra.length||(flag!==undefined&&flag!=='--transpose'))throw Error('Usage: node scripts/mlrank-prepare-weight.mjs INPUT.safetensors TENSOR CACHE_DIRECTORY [--transpose]');
 console.log(JSON.stringify(prepareWeight(input,name,cache,{transpose:flag==='--transpose'}),null,2));
}
