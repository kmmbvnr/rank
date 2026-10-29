// Substitute __KV_FIXTURE__ with scripts/mlrank-kv-check.mjs --fixture output.
async page => {
 const fixture=__KV_FIXTURE__;
 const result=await page.evaluate(async f=>{
  const native=(method,args={})=>window.Capacitor.nativePromise('RamGpu',method,args);
  const send=async (owner,request)=>{
   const id=crypto.randomUUID();
   await native('submit',{id,payload:JSON.stringify({...request,...owner})});
   return fetch('/__rank_ml_result?id='+id).then(r=>r.json());
  };
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const a=await native('openSession'),b=await native('openSession');
  const create=async owner=>{
   const loaded=await send(owner,{action:'load',...f.models.kvwrite});
   check(!loaded.error,'load: '+loaded.error);
   const retained=await send(owner,{action:'invoke',modelId:loaded.modelId,input:[...Array(64).fill(0),1,2,3,4,5,6,7,8,1,...Array(7).fill(0)],retainOutput:true});
   check(!retained.error,'retain: '+retained.error);
   return {modelId:loaded.modelId,stateId:retained.state.id};
  };
  const first=await create(a),second=await create(b);
  check((await send(a,{action:'readState',stateId:second.stateId})).code==='STALE_STATE','Cross-owner read');
  check((await send(a,{action:'releaseState',stateId:second.stateId})).error,'Cross-owner free');
  check((await send(a,{action:'invoke',modelId:second.modelId,input:[]})).code==='STALE_MODEL','Cross-owner invoke');
  await native('closeSession',a);
  check((await send(a,{action:'load',...f.models.kvwrite})).code==='STALE_SESSION','Closed owner created a model');
  check((await send(a,{action:'readState',stateId:first.stateId})).code==='STALE_SESSION','Closed owner read state');
  const surviving=await send(b,{action:'readState',stateId:second.stateId});
  check(surviving.output.slice(0,8).join()==='1,2,3,4,5,6,7,8','Other owner was destroyed');
  const closeAgain=await native('closeSession',a);check(closeAgain.residentStates===1,'Close is not idempotent');
  await native('closeSession',b);
  const c=await native('openSession'),third=await create(c),id=crypto.randomUUID();
  await native('submit',{id,payload:JSON.stringify({...c,action:'invoke',modelId:third.modelId,input:[...Array(64).fill(0),...Array(8).fill(1),1,...Array(7).fill(0)],retainOutput:true})});
  // Start the reply reader, then retire the owner while its request is queued/running.
  const pending=fetch('/__rank_ml_result?id='+id+'&sessionId='+c.sessionId).then(r=>r.json());
  const closed=await native('closeSession',c);await pending;
  check(closed.residentStates===0&&closed.stateBytes===0,'Queued request survived owner close');
  const d=await native('openSession'),last=await create(d);
  localStorage.setItem('rank-gpu-owner-reload-test',JSON.stringify({...d,...last}));
  return {isolatedOwners:true,closedOwnerRejected:true,idempotentClose:true,queuedRequestClosed:true};
 },fixture);
 await page.reload();
 await page.waitForFunction(()=>document.querySelector('#brand')&&!document.querySelector('#brand').disabled);
 const after=await page.evaluate(async()=>{
  const owner=JSON.parse(localStorage.getItem('rank-gpu-owner-reload-test'));localStorage.removeItem('rank-gpu-owner-reload-test');
  const id=crypto.randomUUID();
  await window.Capacitor.nativePromise('RamGpu','submit',{id,payload:JSON.stringify({...owner,action:'readState'})});
  const stale=await fetch('/__rank_ml_result?id='+id).then(r=>r.json());
  const status=await window.Capacitor.nativePromise('RamGpu','closeSession',{sessionId:owner.sessionId});
  if(stale.code!=='STALE_SESSION'||status.residentStates!==0||status.stateBytes!==0)throw Error(JSON.stringify({stale,status}));
  return {pageReloadReclaimed:true,finalStateBytes:status.stateBytes};
 });
 return {...result,...after};
}
