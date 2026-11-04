import { Session } from 'node:inspector/promises';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { Interpreter,parse } = await import(pathToFileURL(resolve(process.argv[2], 'packages/interpreter/out/index.js')));
const source=`fun X adjust Y
 A = X + Y
 B = A * 3
 return B - X
end
Total = 0
for I in 0 till 100000
 Total += I adjust 7
end
Total`;
const runtime=new Interpreter(()=>{},{compilation:false});const program=parse(source);
const session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start');await session.post('HeapProfiler.startSampling',{samplingInterval:4096,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
const start=performance.now();const result=runtime.executeProgram(program);const ms=performance.now()-start;assert.equal(result,10002000000n);
const {profile:cpu}=await session.post('Profiler.stop');const {profile:heap}=await session.post('HeapProfiler.stopSampling');session.disconnect();runtime.dispose();
writeFileSync(process.argv[3] + '-cpu.json',JSON.stringify(cpu));writeFileSync(process.argv[3] + '-heap.json',JSON.stringify(heap));
console.log({result:String(result),ms});console.log(cpu.nodes.filter(n=>n.hitCount).sort((a,b)=>b.hitCount-a.hitCount).slice(0,22).map(n=>[n.callFrame.functionName,n.hitCount,n.callFrame.url.split('/').slice(-2).join('/')]));
const nodes=[];function walk(n){nodes.push(n);n.children.forEach(walk)}walk(heap.head);console.log(nodes.sort((a,b)=>b.selfSize-a.selfSize).slice(0,22).map(n=>[n.callFrame.functionName,n.selfSize,n.callFrame.url.split('/').slice(-2).join('/')]));
