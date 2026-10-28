import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {Interpreter,createRamClient} from '../packages/interpreter/out/index.js';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const directory=resolve(process.argv[2]),plan=JSON.parse(readFileSync(join(directory,'plan.json'))),reference=JSON.parse(readFileSync(process.argv[3]));
const modules=Object.fromEntries(Object.keys(plan.reservations).map(n=>[n,readFileSync(join(directory,n),'utf8')]));
const source=readFileSync(join(directory,'main.ra'),'utf8');
writeFileSync(join(directory,'projection-fixture.json'),JSON.stringify({plan,modules,source,...reference}));
let maxError=0,calls=0;const profiles=[],loads=[];
const check=(values,expected)=>{assert.equal(values.length,expected.length);values.forEach((v,i)=>{const e=Math.abs(v-expected[i]);maxError=Math.max(maxError,e);assert.ok(e<1e-5+Math.abs(expected[i])*1e-4);});};
const client=createRamClient(request=>{const reply=sendRamGpu({...request,...(request.action==='invoke'?{profile:true}:{})});if(request.action==='load')loads.push(reply);if(request.action==='invoke'&&!reply.error){const {output,...p}=reply;profiles.push(p);}return reply;});
let jsWeightBytes=0;
const io={...nodeIo,open(...args){const h=nodeIo.open(...args),read=h.read.bind(h);h.read=n=>{if(args[0]===plan.source.path&&h.position()+n>reference.headerBytes){jsWeightBytes+=n;throw Error('Weight payload in JS');}return read(n);};return h;}};
const r=new Interpreter(undefined,{io,loadModule:n=>({id:n,source:modules[n]}),ramGpu:(g,input,files)=>{
 assert.equal(input.length,plan.inputShape[1]);const d=files[1],start=(d.offset-(reference.tensorOffset??reference.headerBytes))/(plan.inputShape[1]*4);assert.ok(d.length<=plan.chunkBudgetBytes);
 const result=client.invoke(g,()=>Buffer.from(g.model).toString('base64'),input,g.outputShape[1],g.inputs.map(i=>i.shape.reduce((a,b)=>a*b,1)),files,g.reservationBytes).output;
 check(result,reference.expected.slice(start,start+d.shape[0]));calls++;return result;
}});
try{
 r.variables.set('X',{kind:'array',shape:plan.inputShape,items:reference.x});
 const result=r.execute(source.replace(`X = array shape 1 ${plan.inputShape[1]} fill 0.5\n`,''));check(result.items,reference.expected);
 assert.equal(calls,plan.gpuCalls);assert.equal(loads.length,Object.keys(modules).length);assert.equal(profiles.reduce((n,p)=>n+p.fileBytesRead,0),plan.source.shape.reduce((a,b)=>a*b,4));
 client.release();console.log(JSON.stringify({plan,calls,jsWeightBytes,valuesCompared:reference.expected.length*2,maxError,loads,profiles},null,2));
}finally{r.dispose();closeRamGpu();}
