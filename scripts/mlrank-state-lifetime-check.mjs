import assert from 'node:assert/strict';
import {Interpreter} from '../packages/interpreter/out/index.js';
import {nodeRamGpu,sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';
const source='use ml\narg X .f32 shape 1 2\nreturn X relu';
const runtime=new Interpreter(undefined,{ramGpu:nodeRamGpu,loadModule:n=>({id:n,source})});
const status=()=>sendRamGpu({action:'releaseState',stateId:'nonexistent'});
try{
 runtime.execute('use ml\nuse "hold.ram"\nkeep = (hold gpukeep)\nOld = (array 2.0 3.0 shape 1 2) keep');
 for(let i=0;i<70;i++){
  assert.throws(()=>runtime.execute('New = Old keep\n.DomainError "injected failure" raise'),/injected failure/);
  assert.equal(status().residentStates,1);
  assert.deepEqual(runtime.execute('Old gpuread').items,[2,3]);
  assert.throws(()=>runtime.execute('New gpuread'),/released/);
 }
 const fork=runtime.forkForPreview();
 try{
  fork.execute('adapt = (hold gpukeep)\nPreview = Old adapt');
  assert.equal(status().residentStates,2);
  assert.throws(()=>fork.execute('Old gpufree'),/borrowed/);
 }finally{fork.dispose();}
 assert.equal(status().residentStates,1);
 runtime.dispose();
 assert.equal(status().residentStates,0);assert.equal(status().stateBytes,0);
 console.log(JSON.stringify({failedCells:70,previousCellPreserved:true,failedHandlesInvalidated:true,previewOwnedByFork:true,borrowedParentProtected:true,finalStateBytes:0},null,2));
}finally{runtime.dispose();closeRamGpu();}
