import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Interpreter,compileRam,createRamClient} from '../packages/interpreter/out/index.js';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const directory=resolve(process.argv[2]??'/tmp/rank-stream-1gib'),ref=JSON.parse(readFileSync(join(directory,'reference.json')));
const [layers,width]=ref.shape;
let ram=`use ml\narg X .f32 shape 1 ${width}\narg Weights .f32 shape ${ref.shape.join(' ')}\ngpu X block W\nM = W reshape ${width} ${width}\nY = X matmul M\nreturn X + Y\nend\n`;
for(let i=0;i<layers;i++)ram+=`X = X block (Weights (${i} till ${i+1}))\n`;
ram+='return X\n';
const source=`use io\nuse "stream.ram"\nResult = array shape 1 ${width} fill 0.5\nF = "models/stream.safetensors" open\ntry\nWeights' = F tensor "weights"\nResult = Result stream Weights\nfinally\nF close\nend\nResult\n`;
const fixture={...ref,ram,source};writeFileSync(join(directory,'stream-fixture.json'),JSON.stringify(fixture));
if(process.argv.includes('--write-demo')){writeFileSync('demos/mlrank/stream.ram',ram);writeFileSync('demos/mlrank/file-stream.ra',source);}
compileRam(ram,'stream.ram');
if(process.argv.includes('--fixture'))process.exit();
let headerBytesRead=0,jsPayloadBytes=0;
const io={...nodeIo,open(...args){const h=nodeIo.open(...args),read=h.read.bind(h);h.read=count=>{if(h.position()+count>ref.headerBytes){jsPayloadBytes+=count;throw Error('Weight payload entered JavaScript');}headerBytesRead+=count;return read(count);};return h;}};
const events=[];
const client=createRamClient(request=>{const reply=sendRamGpu({...request,...(request.action==='invoke'?{profile:true}:{})});events.push({request,reply});return reply;});
let failAt=0,invocations=0;
const gpu=(g,input,files,options)=>{
 if(++invocations===failAt)throw Error('injected stream failure');
 assert.ok(g.inputs.every(i=>i.shape.reduce((a,b)=>a*b,1)<=4194304));
 const result=client.invoke(g,()=>Buffer.from(g.model).toString('base64'),input,g.outputShape.reduce((a,b)=>a*b,1),g.inputs.map(i=>i.shape.reduce((a,b)=>a*b,1)),files,g.reservationBytes,g.inputs.map(i=>i.dtype??'f32'),{...options,inputNames:g.nodes.flatMap((n,i)=>n.kind==='input'?['t'+i]:[]),outputName:'t'+g.output});
 assert.ok(result.fullyAccelerated);return result.state??result.output;
};gpu.control=client.stateControl;gpu.memory=client.memory;
const runtime=new Interpreter(undefined,{io,loadModule:n=>({id:n,source:ram}),ramGpu:gpu});
const program=source.replace('models/stream.safetensors',join(directory,'stream.safetensors'));
const runs=[];
try{
 for(let repeat=0;repeat<2;repeat++){
  events.length=0;const started=performance.now(),result=runtime.execute(repeat?program.replace(/^use .*\n/gm,''):program),wallMs=performance.now()-started;
  assert.deepEqual(result.shape,[1,width]);let maxError=0;
  result.items.forEach((v,i)=>{const e=Math.abs(v-ref.expected[i]);maxError=Math.max(maxError,e);assert.ok(e<=5e-5+Math.abs(ref.expected[i])*1e-5);});
  const invokes=events.filter(e=>e.request.action==='invoke'&&!e.reply.error),loads=events.filter(e=>e.request.action==='load');
  const ranges=invokes.flatMap(e=>(e.request.inputFiles??[]).filter(Boolean)).sort((a,b)=>a.offset-b.offset);
  let offset=ref.headerBytes;for(const f of ranges){assert.equal(f.offset,offset);offset+=f.length;}assert.equal(offset,ref.fileBytes);
  const fileBytesRead=invokes.reduce((sum,e)=>sum+e.reply.fileBytesRead,0);assert.equal(fileBytesRead,ref.weightBytes);
  assert.equal(events.filter(e=>e.request.action==='readState').length,0);
  const status=sendRamGpu({action:'status'});assert.equal(status.stateBytes,0);
  runs.push({repeat,wallMs,maxError,gpuCalls:invokes.length,modelLoads:loads.length,modelBytesSent:loads.reduce((sum,e)=>sum+Buffer.from(e.request.model,'base64').length,0),fileBytesRead,outputBytesRead:invokes.reduce((sum,e)=>sum+e.reply.outputBytesRead,0),maxReservationBytes:Math.max(...loads.map(e=>e.request.reservationBytes),0),peakNativeAccountedBytes:Math.max(...invokes.map(e=>e.reply.residentBytes)),peakRssBytes:Math.max(...invokes.map(e=>e.reply.peakRssBytes??0)),inlineValuesSent:invokes.reduce((sum,e)=>sum+e.request.input.length,0),finalStateBytes:status.stateBytes});
 }
 failAt=2;invocations=0;assert.throws(()=>runtime.execute(program.replace(/^use .*\n/gm,'')),/injected stream failure/);assert.equal(sendRamGpu({action:'status'}).stateBytes,0);
 console.log(JSON.stringify({platform:process.platform,weightBytes:ref.weightBytes,fileBytes:statSync(join(directory,'stream.safetensors')).size,sha256:ref.sha256,headerBytesRead,jsPayloadBytes,jsMemory:process.memoryUsage(),jsPeakRssBytes:process.resourceUsage().maxRSS*1024,runs,failureCleanup:true},null,2));
}finally{runtime.dispose();client.release();closeRamGpu();}
