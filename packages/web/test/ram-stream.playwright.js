// Substitute __RAM_STREAM_FIXTURE__ from mlrank-stream-check.mjs --fixture.
async page => {
 const fixture=__RAM_STREAM_FIXTURE__;
 await page.waitForFunction(()=>document.querySelector('#input')?.getAttribute('aria-busy')!=='true');
 return page.evaluate(async f=>{
  const native=(method,args={})=>window.Capacitor.nativePromise('RamGpu',method,args),owner=await native('openSession');
  const main=document.querySelector('script[type="module"][src]').src,code=await fetch(main).then(r=>r.text()),url=new URL(code.match(/worker-[A-Za-z0-9_-]+\.js/)[0],main).href;
  const instrumentation=`const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;
   XMLHttpRequest.prototype.open=function(method,url,...args){this.profileUrl=new URL(url,${JSON.stringify(main)}).href;return open.call(this,method,this.profileUrl,...args);};
   XMLHttpRequest.prototype.send=function(...args){const url=new URL(this.profileUrl),entry={path:url.pathname,id:url.searchParams.get('id')};
    if(url.pathname==='/__rank_model_file'&&url.searchParams.has('count')){entry.fileReadBytes=Number(url.searchParams.get('count'));if(Number(url.searchParams.get('offset'))+entry.fileReadBytes>${f.headerBytes})throw Error('Weights entered JavaScript');}
    try{return send.apply(this,args);}finally{if(url.pathname==='/__rank_ml_result'){const r=JSON.parse(this.responseText);entry.reply=Object.fromEntries(Object.entries(r).filter(([k,v])=>typeof v==='number'||typeof v==='boolean'||k==='error'||k==='code'));}postMessage({profile:entry});}
   };await import(${JSON.stringify(url)});postMessage({profileReady:true});`;
  const blob=URL.createObjectURL(new Blob([instrumentation],{type:'text/javascript'})),worker=new Worker(blob,{type:'module'}),pending=new Map(),requests=new Map();
  let entries=[],sequence=0,fail=false,invokes=0,ready;const boot=new Promise(resolve=>{ready=resolve;});
  worker.onmessage=event=>{const m=event.data;
   if(m.profileReady){ready();return;}if(m.profile){entries.push(m.profile);return;}
   if(m.ram){const request=JSON.parse(m.ram.payload);if(request.action==='invoke'&&++invokes===2&&fail){request.inputFiles=request.inputFiles.map(file=>file?{...file,revision:'stale'}:null);}
    requests.set(m.ram.id,request);void native('submit',{id:m.ram.id,payload:JSON.stringify({...request,...owner,profile:true})}).catch(e=>{for(const p of pending.values())p.reject(e);});return;}
   const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m);}
  };
  worker.onerror=e=>{for(const p of pending.values())p.reject(Error(e.message));};
  const post=(message,id)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Stream timeout')),240000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});worker.postMessage(message);});
  const call=(method,args)=>{const id=++sequence;return post({id,method,args},id);};
  const status=async()=>{const id=crypto.randomUUID();await native('submit',{id,payload:JSON.stringify({...owner,action:'status'})});return fetch('/__rank_ml_result?id='+id+'&sessionId='+owner.sessionId).then(r=>r.json());};
  const runs=[];
  try{
   await boot;await post({nativeRam:true,nativeFiles:true,ramSessionId:owner.sessionId,modules:{'stream.ram':f.ram}},0);
   for(let repeat=0;repeat<2;repeat++){
    entries=[];requests.clear();const source=repeat?f.source.replace(/^use .*\n/gm,''):f.source;
    const start=performance.now(),result=(await call('execute',[source,1,source.split('\n')])).result,wallMs=performance.now()-start;
    if(!result.ok)throw Error(JSON.stringify(result));
    const values=[];for(let at=0;at<f.expected.length;at+=256){const view=(await call('inspect',[result.valueRef,{offset:[0,at],count:[1,Math.min(256,f.expected.length-at)]}])).result;values.push(...view.cells.flat().map(c=>Number(c.text)));}
    let maxError=0;values.forEach((v,i)=>{const e=Math.abs(v-f.expected[i]);if(!Number.isFinite(e)||e>5e-5+Math.abs(f.expected[i])*1e-5)throw Error('Wrong numerical result');maxError=Math.max(maxError,e);});
    const calls=entries.filter(e=>requests.get(e.id)?.action==='invoke'&&!e.reply.error),loads=[...requests.values()].filter(r=>r.action==='load');
    const ranges=calls.flatMap(e=>requests.get(e.id).inputFiles.filter(Boolean)).sort((a,b)=>a.offset-b.offset);let offset=f.headerBytes;
    for(const range of ranges){if(range.offset!==offset)throw Error('Weight range gap or duplicate');offset+=range.length;}if(offset!==f.fileBytes)throw Error('Incomplete weight coverage');
    const fileBytesRead=calls.reduce((s,e)=>s+e.reply.fileBytesRead,0);if(fileBytesRead!==f.weightBytes)throw Error('Native did not read all weights');
    if([...requests.values()].some(r=>r.action==='readState'))throw Error('Intermediate readback');
    const after=await status();if(after.stateBytes!==0)throw Error('GPU states leaked');
    runs.push({repeat,wallMs,maxError,valuesCompared:values.length,gpuCalls:calls.length,modelLoads:loads.length,fileBytesRead,headerBytesRead:entries.reduce((s,e)=>s+(e.fileReadBytes??0),0),jsPayloadBytes:0,outputBytesRead:calls.reduce((s,e)=>s+e.reply.outputBytesRead,0),peakNativeAccountedBytes:Math.max(...calls.map(e=>e.reply.residentBytes)),peakPssBytes:Math.max(...calls.map(e=>e.reply.pssBytes)),finalStateBytes:after.stateBytes});
   }
   fail=true;invokes=0;const source=f.source.replace(/^use .*\n/gm,'');
   const failed=(await call('execute',[source,1,source.split('\n')])).result;
   if(failed.ok||!failed.output.some(line=>/changed/i.test(line.text)))throw Error('Missing stale file rejection');
   const after=await status();if(after.stateBytes!==0)throw Error('Failure leaked states');
   return {weightBytes:f.weightBytes,sha256:f.sha256,runs,staleFileRejected:true,failureCleanup:true};
  }finally{worker.terminate();URL.revokeObjectURL(blob);await native('closeSession',owner);}
 },fixture);
}
