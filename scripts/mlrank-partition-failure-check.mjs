import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileRam} from '../packages/interpreter/out/index.js';
import {executeRamGraph} from '../packages/interpreter/out/ram-plan.js';
import {nodeRamGpu,sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const source=readFileSync(new URL('../demos/mlrank/transformerstack.ram',import.meta.url),'utf8');
const graph=compileRam(source,'transformerstack.ram').graph;
const input=Array.from({length:18},(_,i)=>Math.fround(Math.sin(i+1)*.7)),failures=[];
try {
 for(let stage=1;stage<=graph.parts.length;stage++){
  let calls=0;
  const gpu=(g,data,files,options)=>nodeRamGpu(g,++calls===stage?[...data,999]:data,files,options);
  gpu.control=nodeRamGpu.control;
  assert.throws(()=>executeRamGraph(graph,gpu,input),/input|shape/i);
  const status=sendRamGpu({action:'releaseState',stateId:'nonexistent'});
  assert.equal(status.stateBytes,0);assert.equal(status.residentStates,0);
  failures.push({stage,invokes:calls,finalStateBytes:status.stateBytes});
 }
 const result=executeRamGraph(graph,nodeRamGpu,input);
 assert.equal(result.length,18);assert.ok(result.every(Number.isFinite));
 console.log(JSON.stringify({platform:process.platform,failures,recovered:true},null,2));
}finally{closeRamGpu();}
