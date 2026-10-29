// Substitute __GPT2_KV_BENCH_FIXTURE__ with mlrank-gpt2-kv-bench.mjs --fixture.
// Profiles a real worker. Native dispatch timing may include synchronization;
// readback may wait for GPU completion. These are host intervals, not kernel timers.
async page => {
 const fixture=__GPT2_KV_BENCH_FIXTURE__;
 await page.waitForFunction(()=>document.querySelector('#input')?.getAttribute('aria-busy')!=='true',null,{timeout:180000});
 return page.evaluate(async f=>{
  const native=(method,args={})=>window.Capacitor.nativePromise('RamGpu',method,args);
  const main=document.querySelector('script[type="module"][src]').src,code=await fetch(main).then(r=>r.text());
  const url=new URL(code.match(/worker-[A-Za-z0-9_-]+\.js/)[0],main).href;
  const instrumentation=`
   const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;
   XMLHttpRequest.prototype.open=function(method,url,...args){this.profileUrl=new URL(url,${JSON.stringify(main)}).href;return open.call(this,method,this.profileUrl,...args);};
   XMLHttpRequest.prototype.send=function(...args){
    const started=performance.now();
    try{return send.apply(this,args);}finally{
     const url=new URL(this.profileUrl,self.location.href),entry={path:url.pathname,action:url.searchParams.get('action'),id:url.searchParams.get('id'),elapsedMs:performance.now()-started};
     if(url.pathname==='/__rank_ml_result'){
      const r=JSON.parse(this.responseText);entry.reply=Object.fromEntries(Object.entries(r).filter(([k,v])=>typeof v==='number'||typeof v==='boolean'||k==='code'||k==='error'||k==='modelId'));
     }
     postMessage({profile:entry});
    }
   };
   await import(${JSON.stringify(url)});
   postMessage({profileReady:true});`;
  const blob=URL.createObjectURL(new Blob([instrumentation],{type:'text/javascript'}));
  const runs=[];
  try{
   for(const mode of f.profileModes??['kv','kv']){
    const owner=await native('openSession'),worker=new Worker(blob,{type:'module'}),pending=new Map(),requests=new Map(),entries=[];let sequence=0;
    let startedWorker;const boot=new Promise(resolve=>{startedWorker=resolve;});
    worker.onmessage=event=>{
     const m=event.data;
     if(m.profileReady){startedWorker();return;}
     if(m.profile){entries.push(m.profile);return;}
     if(m.ram){const request=JSON.parse(m.ram.payload);requests.set(m.ram.id,request);void native('submit',{id:m.ram.id,payload:JSON.stringify({...request,...owner,profile:true})}).catch(e=>{for(const p of pending.values())p.reject(e);});return;}
     const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m);}
    };
    worker.onerror=event=>{for(const p of pending.values())p.reject(Error(event.message));};
    const post=(message,id)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Profile timeout')),240000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});worker.postMessage(message);});
    const call=(method,args)=>{const id=++sequence;return post({id,method,args},id);};
    try{
     await boot;await post({nativeRam:true,nativeFiles:true,ramSessionId:owner.sessionId,modules:f.modules},0);
     const source=f.programs[mode],started=performance.now();
     const r=await call('execute',[source,1,source.split('\n')]),totalMs=performance.now()-started;
     if(!r.result.ok)throw Error(JSON.stringify(r.result));
     if((await call('inspect',[r.result.valueRef,{}])).result.text!==(f.expected??"Hello, I'm"))throw Error('Unexpected generated text');
     const models=new Map(),calls=entries.map(e=>{
      const request=requests.get(e.id);
      if(!request)return e;
      if(request.action==='load'&&e.reply.modelId)models.set(e.reply.modelId,request.inputSizes);
      return {...e,action:request.action,inputSizes:request.inputSizes??models.get(request.modelId),outputSize:request.outputSize,retainOutput:!!request.retainOutput};
     });
     const status=await native('closeSession',owner);
     if(status.stateBytes!==0)throw Error('States leaked');
     const groups={};
     for(const call of calls){
      const key=call.path+':'+String(call.action??'read');
      const group=groups[key]??={count:0,wallMs:0,prepareMs:0,inputMs:0,dispatchMs:0,readbackMs:0,outputMs:0,fileBytesRead:0,tensorAllocationMs:0,fileReadMs:0,fileDecodeMs:0,bufferWriteMs:0};
      group.count++;group.wallMs+=call.elapsedMs;
      for(const field of ['prepareMs','inputMs','dispatchMs','readbackMs','outputMs','fileBytesRead','tensorAllocationMs','fileReadMs','fileDecodeMs','bufferWriteMs'])group[field]+=call.reply?.[field]??0;
     }
     runs.push({mode,totalMs,text:f.expected??"Hello, I'm",finalStateBytes:status.stateBytes,
      outsideXhrMs:totalMs-calls.reduce((sum,call)=>sum+call.elapsedMs,0),groups});
    }finally{worker.terminate();await native('closeSession',owner);}
   }
  }finally{URL.revokeObjectURL(blob);}
  return {runs,notes:['Native profile includes per-invoke PSS collection overhead.','Host intervals do not isolate GPU kernel time.']};
 },fixture);
}
