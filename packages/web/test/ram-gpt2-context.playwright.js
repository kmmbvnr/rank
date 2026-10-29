// Substitute __GPT2_CONTEXT_FIXTURE__ from mlrank-gpt2-context-check.mjs --fixture.
async page => {
 const fixture=__GPT2_CONTEXT_FIXTURE__;
 await page.waitForFunction(()=>document.querySelector('#input')?.getAttribute('aria-busy')!=='true',null,{timeout:180000});
 return page.evaluate(async f=>{
  const native=(method,args={})=>window.Capacitor.nativePromise('RamGpu',method,args);
  const main=document.querySelector('script[type="module"][src]').src,code=await fetch(main).then(r=>r.text());
  const asset=new URL(code.match(/worker-[A-Za-z0-9_-]+\.js/)[0],main);
  const runs=[],boundaries=[],invalid=[];let valuesCompared=0,maxError=0,cacheReadbackRequests=0;
  for(const c of [...f.reference.cases,...f.reference.boundaries,...f.reference.invalid]){
   const owner=await native('openSession'),worker=new Worker(asset,{type:'module'}),pending=new Map(),requests=[];let sequence=0;
   worker.onmessage=event=>{const m=event.data;if(m.ram){requests.push(JSON.parse(m.ram.payload));void native('submit',{id:m.ram.id,payload:JSON.stringify({...JSON.parse(m.ram.payload),...owner})}).catch(e=>{for(const p of pending.values())p.reject(e);});return;}const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m);}};
   worker.onerror=e=>{for(const p of pending.values())p.reject(Error(e.message));};
   const post=(message,id)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Context check timeout')),240000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});worker.postMessage(message);});
   const call=(method,args)=>{const id=++sequence;return post({id,method,args},id);};
   const execute=async source=>(await call('execute',[source,1,source.split('\n')])).result;
   const scalar=async source=>{const result=await execute(source);if(!result.ok)throw Error(JSON.stringify(result));return (await call('inspect',[result.valueRef,{}])).result.text;};
   try{
    await post({nativeRam:true,nativeFiles:true,ramSessionId:owner.sessionId,modules:f.modules},0);
    let source=f.source.replace(/^Prompt = .*$/m,'Prompt = '+JSON.stringify(c.prompt)).replace(/^MaxNew = .*$/m,'MaxNew = '+c.maxNew);
    if(c.poison)source=source.replace('Empty = array shape ContextLimit 1536 fill 0.0','Empty = ((1 to (ContextLimit * 1536)) * 0.00001) reshape ContextLimit 1536');
    if(c.steps)source=source.replace('for Position in','Trace = array shape '+c.steps.length+' 50257 fill 0.0\nfor Position in').replace('Next = Logits max .index','Trace Generated # = Logits\nNext = Logits max .index').replace('F close\nTokens bpedecode Config','F close\nTrace');
    const started=performance.now(),result=await execute(source),wallMs=performance.now()-started;
    if(c.message){if(result.ok||requests.length||!result.output.some(line=>line.text.includes(c.message)))throw Error('Invalid input accepted, wrong error or GPU touched');invalid.push(c.message);continue;}
    if(!result.ok)throw Error(JSON.stringify(result));
    if(!c.steps){
    if(await scalar('StopReason')!==c.reason)throw Error('Wrong stop reason');
    if(await scalar('Tokens bpedecode Config')!==(c.text??c.prompt))throw Error('Wrong text');
     if(requests.length)throw Error('Boundary touched GPU');boundaries.push(c.reason);continue;}
    // Keep each inspection below the viewer's work budget even with many decode steps.
    for(let step=0;step<c.steps.length;step++)for(let column=0;column<50257;column+=1000){
     const viewed=(await call('inspect',[result.valueRef,{offset:[step,column],count:[1,Math.min(1000,50257-column)]}])).result;
     if(!viewed.cells)throw Error(c.name+' inspection: '+JSON.stringify(viewed));
     viewed.cells[0].forEach((cell,j)=>{
      const actual=Number(cell.text),expected=c.steps[step].logits[column+j],error=Math.abs(actual-expected);
      if(!Number.isFinite(actual)||error>5e-4+Math.abs(expected)*1e-4)throw Error(c.name+' logit '+step+':'+(column+j)+' mismatch');
      maxError=Math.max(maxError,error);valuesCompared++;
     });
    }
    if(await scalar('StopReason')!==c.reason)throw Error('Wrong stop reason');
    if(await scalar('Tokens bpedecode Config')!==(c.text??c.prompt))throw Error('Wrong text');
    const id=crypto.randomUUID();await native('submit',{id,payload:JSON.stringify({...owner,action:'releaseState',stateId:'nonexistent'})});
    const status=await fetch('/__rank_ml_result?id='+id+'&sessionId='+owner.sessionId).then(r=>r.json());
    if(status.stateBytes!==0||status.residentStates!==0)throw Error('States leaked');
    cacheReadbackRequests+=requests.filter(r=>r.action==='readState').length;
    runs.push({name:c.name,promptTokens:c.promptTokens.length,generated:c.tokens.length-c.promptTokens.length,text:c.text,reason:c.reason,wallMs,gpuCalls:requests.filter(r=>r.action==='invoke').length,finalStateBytes:0});
   }finally{worker.terminate();await native('closeSession',owner);}
  }
  if(cacheReadbackRequests)throw Error('KV cache was read into JS');
  if(valuesCompared!==f.reference.cases.reduce((sum,c)=>sum+c.steps.length*50257,0))throw Error('Missing logits');
  return {context:16,runs,boundaries,invalid,valuesCompared,maxError,cacheReadbackRequests};
 },fixture);
}
