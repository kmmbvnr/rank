// Substitute __GPT2_FORWARD_FIXTURE__ with forward-fixture.json from the desktop check.
async page => {
 const fixture=__GPT2_FORWARD_FIXTURE__;
 return page.evaluate(async f=>{
  const main=document.querySelector('script[type="module"][src]').src;
  const code=await fetch(main).then(r=>r.text());
  const worker=new Worker(new URL(code.match(/worker-[A-Za-z0-9_-]+\.js/)[0],main),{type:'module'});
  const pending=new Map(),requests=[],checks=[],profiles=[],outputs=[];
  let sequence=0;
  worker.onmessage=event=>{
   const m=event.data;
   if(m.ram){requests.push(JSON.parse(m.ram.payload));void window.Capacitor.nativePromise('RamGpu','submit',m.ram).catch(e=>{for(const p of pending.values())p.reject(e);});return;}
   const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m);}
  };
  const post=(message,id)=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Forward timeout')),120000);
   pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
   worker.postMessage(message);
  });
  const call=(method,args)=>{const id=++sequence;return post({id,method,args},id);};
  const raw=async request=>{
   const id=crypto.randomUUID();await window.Capacitor.nativePromise('RamGpu','submit',{id,payload:JSON.stringify(request)});
   const reply=await fetch('/__rank_ml_result?id='+id).then(r=>r.json());if(reply.error)throw Error(reply.error);return reply;
  };
  const check=(values,expected,label)=>{
   if(values.length!==expected.length)throw Error('Wrong length: '+label);
   let maxError=0;
   values.forEach((v,i)=>{const error=Math.abs(v-expected[i]);maxError=Math.max(maxError,error);if(!Number.isFinite(v)||error>f.tolerance.absolute+Math.abs(expected[i])*f.tolerance.relative)throw Error(label+' '+i+': '+v+' != '+expected[i]);});
   checks.push({label,values:values.length,maxError});
  };
  try{
   await post({nativeRam:true,nativeFiles:true,modules:f.modules},0);
   for(let runIndex=0;runIndex<f.sources.length;runIndex++){
    const source=runIndex?f.sources[runIndex].replace(/^use "[^\n]+\n/gm,''):f.sources[runIndex];
    const start=requests.length,run=await call('execute',[source,1,source.split('\n')]);
    if(!run.result.ok)throw Error(JSON.stringify(run.result));
    const c=f.cases[runIndex===1?1:0];
    const expected=[...f.expected[runIndex===1?1:0],...Array.from({length:50},(_,i)=>({label:'head-'+i,values:Array.from({length:4},(_,row)=>c.logits.slice(row*50257+i*1024,row*50257+Math.min((i+1)*1024,50257))).flat()}))];
    const invokes=requests.slice(start).filter(r=>r.action==='invoke');
    const loadRequests=new Map(),replayIds=new Map();let lastLoad;
    for(const request of requests.slice(start)){
     if(request.action==='load')lastLoad=request;
     if(request.action==='invoke'&&!loadRequests.has(request.modelId))loadRequests.set(request.modelId,lastLoad);
    }
    if(invokes.length!==79)throw Error('Expected 79 GPU calls, got '+invokes.length);
    const rows=Array.from({length:4},()=>[]);
    for(let column=0;column<50257;column+=1000){
     const v=await call('inspect',[run.result.valueRef,{offset:[0,column],count:[4,Math.min(1000,50257-column)]}]);
     for(let row=0;row<4;row++)rows[row].push(...v.result.cells[row].map(cell=>Number(cell.text)));
    }
    check(rows.flat(),c.logits,'run-'+runIndex+'-worker-return');
    const ids=rows.map(values=>values.reduce((best,value,i)=>value>values[best]?i:best,0));
    if(JSON.stringify(ids)!==JSON.stringify(c.argmax))throw Error('Argmax differs');
    outputs.push([]);
    // Replay exact worker requests to inspect every block and native memory counters.
    for(let i=0;i<invokes.length;i++){
     if(!replayIds.has(invokes[i].modelId)){
      const load=loadRequests.get(invokes[i].modelId);if(!load)throw Error('Missing graph for replay');
      replayIds.set(invokes[i].modelId,(await raw(load)).modelId);
     }
     const {output,...profile}=await raw({...invokes[i],modelId:replayIds.get(invokes[i].modelId),profile:true});
     check(output,expected[i].values,'run-'+runIndex+'-'+expected[i].label);profiles.push(profile);outputs[runIndex].push(output);
     if(profile.residentModels>4||profile.residentBytes>128*1024*1024)throw Error('Resident budget exceeded');
     if(i>3&&i<28&&profile.fileBytesRead===0)throw Error('Layer weights did not change');
    }
    for(const id of replayIds.values())await raw({action:'release',modelId:id});
   }
   for(let i=4;i<79;i++)if(outputs[0][i].slice(0,outputs[0][i].length/4*3).some((v,j)=>v!==outputs[1][i][j]))throw Error('Causality failed at '+i);
   if(JSON.stringify(outputs[0])!==JSON.stringify(outputs[2]))throw Error('Repeat changed results');
   const loads=requests.filter(r=>r.action==='load');if(loads.length!==18)throw Error('Graphs were not reused: '+loads.length+' loads');
   for(const id of new Set(requests.filter(r=>r.action==='invoke').map(r=>r.modelId)))await raw({action:'release',modelId:id});
   return {workerGpuCalls:237,profileGpuCalls:237,modelLoads:loads.length,checks,valuesCompared:checks.reduce((n,c)=>n+c.values,0),causalityVerified:true,repeatVerified:true,profiles};
  }finally{worker.terminate();}
 },fixture);
}
