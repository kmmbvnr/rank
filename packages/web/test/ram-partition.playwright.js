// Substitute fixtures from mlrank-transformer-check.mjs --partition --fixture.
async page => {
 const fixtures=__RAM_PARTITION_FIXTURES__;
 await page.waitForFunction(()=>document.querySelector('#input')?.getAttribute('aria-busy')!=='true');
 return page.evaluate(async fixtures=>{
  const main=document.querySelector('script[type="module"][src]').src,code=await fetch(main).then(r=>r.text());
  const asset=new URL(code.match(/worker-[A-Za-z0-9_-]+\.js/)[0],main),checks=[],failures=[];
  const native=(method,args={})=>window.Capacitor.nativePromise('RamGpu',method,args);
  for(const f of fixtures){
   const owner=await native('openSession'),worker=new Worker(asset,{type:'module'}),pending=new Map(),requests=[];let sequence=0,failAt=0,invocations=0;
   worker.onmessage=event=>{const m=event.data;if(m.ram){const request=JSON.parse(m.ram.payload);requests.push(request);if(request.action==='invoke'&&++invocations===failAt)request.input=[...request.input,999];void native('submit',{id:m.ram.id,payload:JSON.stringify({...request,...owner})}).catch(e=>{for(const p of pending.values())p.reject(e);});return;}const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m);}};
   worker.onerror=e=>{for(const p of pending.values())p.reject(Error(e.message));};
   const post=(message,id)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Function check timeout')),60000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});worker.postMessage(message);});
   const call=(method,args)=>{const id=++sequence;return post({id,method,args},id);};
   try{
    await post({nativeRam:true,nativeFiles:true,ramSessionId:owner.sessionId,modules:{'transformer.ram':f.source}},0);
    const input='use sequences\nuse "transformer.ram"\nX = array shape '+f.inputShape.join(' ')+'\n'+f.input.map(n=>Number.isInteger(n)?n+'.0':String(n)).join(' ')+'\nend\n';
    for(let repeat=0;repeat<3;repeat++){
     const start=performance.now();
     const before=requests.filter(r=>r.action==='invoke').length;
     const source=(repeat===0?input:'')+'Y = X transformer\nY reshape 1 '+f.expected.length;
     const result=(await call('execute',[source,1,source.split('\n')])).result;
     if(!result.ok)throw Error(JSON.stringify(result));
     const view=(await call('inspect',[result.valueRef,{count:[1,f.expected.length]}])).result;
     if(view.cells?.[0]?.length!==f.expected.length)throw Error('Wrong output shape');
     let maxError=0;
     view.cells[0].forEach((cell,i)=>{const e=Math.abs(Number(cell.text)-f.expected[i]);if(!Number.isFinite(e)||e>1e-5+Math.abs(f.expected[i])*1e-5)throw Error('Numerical mismatch '+f.stage);maxError=Math.max(maxError,e);});
     const gpuCalls=requests.filter(r=>r.action==='invoke').length-before;
     if(gpuCalls!==f.partCount)throw Error('Wrong part invocation count');
     const id=crypto.randomUUID();await native('submit',{id,payload:JSON.stringify({...owner,action:'releaseState',stateId:'nonexistent'})});
     const status=await fetch('/__rank_ml_result?id='+id+'&sessionId='+owner.sessionId).then(r=>r.json());
     if(status.stateBytes!==0)throw Error('Intermediate states leaked');
     if(requests.some(r=>r.action==='readState'))throw Error('Intermediate readback');
     checks.push({stage:f.stage,repeat,values:f.expected.length,maxError,gpuCalls,wallMs:performance.now()-start,finalStateBytes:status.stateBytes});
    }
    if(f===fixtures[0])for(let stage=1;stage<=f.partCount;stage++){
     failAt=stage;invocations=0;
     const result=(await call('execute',['X transformer',1,['X transformer']])).result;
     failAt=0;
     if(result.ok)throw Error('Missing native stage failure');
     const id=crypto.randomUUID();await native('submit',{id,payload:JSON.stringify({...owner,action:'releaseState',stateId:'nonexistent'})});
     const status=await fetch('/__rank_ml_result?id='+id+'&sessionId='+owner.sessionId).then(r=>r.json());
     if(status.stateBytes!==0)throw Error('Failure leaked GPU states');
     failures.push({stage,finalStateBytes:status.stateBytes});
    }
   }finally{worker.terminate();await native('closeSession',owner);}
  }
  return {checks,failures,valuesCompared:checks.reduce((sum,c)=>sum+c.values,0),maxError:Math.max(...checks.map(c=>c.maxError))};
 },fixtures);
}
