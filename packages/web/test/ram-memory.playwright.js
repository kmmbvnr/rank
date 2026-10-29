// Substitute __RAM_MEMORY_FIXTURE__ from mlrank-memory-check.mjs --fixture.
async page => {
 const fixture=__RAM_MEMORY_FIXTURE__;
 return page.evaluate(async f=>{
  const native=(method,args={})=>window.Capacitor.nativePromise('RamGpu',method,args);
  const owner=await native('openSession');let worker;
  const raw=async request=>{const id=crypto.randomUUID();await native('submit',{id,payload:JSON.stringify({...request,...owner})});const result=await fetch('/__rank_ml_result?id='+id+'&sessionId='+owner.sessionId).then(r=>r.json());if(result.error)throw Error(result.error);return result;};
  try{
   const load=()=>raw({action:'load',...f.small,reservationBytes:64*1024*1024});
   await load();const b=await load();
   const kept=await raw({action:'invoke',modelId:b.modelId,input:[1],outputSize:1,retainOutput:true});
   if(kept.residentModels!==1||kept.stateBytes!==4)throw Error('Cache not evicted for retained output');
   await raw({action:'releaseState',stateId:kept.state.id});await raw({action:'release',modelId:b.modelId});
   const pressure=await raw({action:'load',...f.pressure});let status=await raw({action:'status'}),previous=null,pressureStates=0;
   while(status.stateBytes+f.pressure.reservationBytes+4194304<=status.memoryBudgetBytes){
    const result=await raw({action:'invoke',modelId:pressure.modelId,input:previous?[]:Array(1048576).fill(1),...(previous?{inputStates:[previous]}:{}),outputSize:1048576,retainOutput:true});
    previous=result.state.id;pressureStates++;status=result;
   }
   const pressureBytes=status.stateBytes,availableBytes=status.memoryBudgetBytes-pressureBytes;
   const main=document.querySelector('script[type="module"][src]').src,code=await fetch(main).then(r=>r.text()),asset=new URL(code.match(/worker-[A-Za-z0-9_-]+\.js/)[0],main);
   worker=new Worker(asset,{type:'module'});const pending=new Map(),requests=[];let sequence=0;
   worker.onmessage=event=>{const m=event.data;if(m.ram){const request=JSON.parse(m.ram.payload);requests.push(request);void native('submit',{id:m.ram.id,payload:JSON.stringify({...request,...owner})}).catch(e=>{for(const p of pending.values())p.reject(e);});return;}const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m);}};
   worker.onerror=e=>{for(const p of pending.values())p.reject(Error(e.message));};
   const post=(message,id)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Memory check timed out')),120000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});worker.postMessage(message);});
   await post({nativeRam:true,nativeFiles:true,ramSessionId:owner.sessionId,modules:{'memory.ram':f.source}},0);
   const source='use "memory.ram"\nX = array shape 256 256 fill 1.0\nX memory';
   const id=++sequence,start=performance.now();const result=(await post({id,method:'execute',args:[source,1,source.split('\n')]},id)).result;
   if(!result.ok)throw Error(JSON.stringify(result));
   const cells=[];
   for(let row=0;row<256;row+=8){
    const inspectId=++sequence;const view=(await post({id:inspectId,method:'inspect',args:[result.valueRef,{offset:[row,0],count:[8,256]}]},inspectId)).result;
    if(!view.cells)throw Error(JSON.stringify(view));cells.push(...view.cells.flat());
   }
   if(cells.length!==65536||cells.some(c=>Number(c.text)!==1))throw Error('Wrong numerical result');
   const parts=requests.filter(r=>r.action==='invoke').length;
   if(parts<2||!requests.some(r=>r.action==='status')||requests.some(r=>r.action==='readState'))throw Error('Memory plan not used');
   const after=await raw({action:'status'});if(after.stateBytes!==pressureBytes)throw Error('Borrowed state changed or internal state leaked');
   return {pressureStates,pressureBytes,availableBytes,parts,valuesCompared:cells.length,wallMs:performance.now()-start,retentionEvictedCachedModel:true,borrowedStatesPreserved:true,internalStateBytes:after.stateBytes-pressureBytes};
  }finally{worker?.terminate();const final=await native('closeSession',owner);if(final.stateBytes!==0)throw Error('Pressure states leaked');}
 },fixture);
}
