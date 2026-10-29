// Replace the fixture placeholder with scripts/mlrank-gpt2-kv-check.mjs --fixture output.
async page => {
 const fixture=__GPT2_KV_FIXTURE__;
 await page.waitForFunction(()=>document.querySelector('#input')?.getAttribute('aria-busy')!=='true',null,{timeout:120000});
 return page.evaluate(async f=>{
  const main=document.querySelector('script[type="module"][src]').src,code=await fetch(main).then(r=>r.text());
  const worker=new Worker(new URL(code.match(/worker-[A-Za-z0-9_-]+\.js/)[0],main),{type:'module'});
  const pending=new Map(),requests=[],checks=[],runs=[];let sequence=0;
  worker.onmessage=event=>{const m=event.data;if(m.ram){requests.push(JSON.parse(m.ram.payload));void window.Capacitor.nativePromise('RamGpu','submit',m.ram).catch(e=>{for(const p of pending.values())p.reject(e);});return;}const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m);}};
  const post=(message,id)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('KV check timeout')),240000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});worker.postMessage(message);});
  const call=(method,args)=>{const id=++sequence;return post({id,method,args},id);};
  const execute=async source=>{const r=await call('execute',[source,1,source.split('\n')]);if(!r.result.ok)throw Error(JSON.stringify(r.result));return r.result;};
  const scalar=async source=>{const result=await execute(source);return (await call('inspect',[result.valueRef,{}])).result.text;};
  const send=async request=>{const id=crypto.randomUUID();await window.Capacitor.nativePromise('RamGpu','submit',{id,payload:JSON.stringify(request)});return fetch('/__rank_ml_result?id='+id).then(r=>r.json());};
  const check=(actual,expected)=>{let maxError=0;if(actual.length!==expected.length)throw Error('Shape mismatch');actual.forEach((v,i)=>{const e=Math.abs(v-expected[i]);maxError=Math.max(maxError,e);if(!Number.isFinite(v)||e>5e-4+Math.abs(expected[i])*1e-4)throw Error('Logit '+i+': '+v+' != '+expected[i]);});checks.push({maxError,values:actual.length});};
  try{
   await post({nativeRam:true,nativeFiles:true,modules:f.modules},0);
   for(const [prompt,limit,start] of [['Hello',4,0],['Hello,',2,1]]){
    let source=f.source.replace('Prompt = "Hello"','Prompt = '+JSON.stringify(prompt)).replace('MaxNew = 3','MaxNew = '+limit);
    if(runs.length)source=source.replace(/^use "[^\n]+\n/gm,'');
    source=source.replace('for Position in','Trace = array shape 3 50257 fill 0.0\nfor Position in').replace('Next = Logits max .index','Trace Generated # = Logits\nNext = Logits max .index').replace('F close\nTokens bpedecode Config','F close\nTrace');
    const before=requests.length,started=performance.now(),result=await execute(source),wallMs=performance.now()-started;
    const rows=Array.from({length:3-start},()=>[]);
    for(let column=0;column<50257;column+=1000){const v=await call('inspect',[result.valueRef,{offset:[0,column],count:[3-start,Math.min(1000,50257-column)]}]);rows.forEach((row,i)=>row.push(...v.result.cells[i].map(c=>Number(c.text))));}
    rows.forEach((row,i)=>check(row,f.reference.steps[start+i].logits));
    if(await scalar('Tokens bpedecode Config')!==f.reference.text)throw Error('Text mismatch');
    if(await scalar('StopReason')!==(limit===4?'context limit':'token limit'))throw Error('Stop reason mismatch');
    const status=await send({action:'releaseState',stateId:'nonexistent'});
    if(status.residentStates!==0||status.stateBytes!==0)throw Error('Leaked cache');
    runs.push({prompt,wallMs,gpuCalls:requests.slice(before).filter(r=>r.action==='invoke').length,finalStateBytes:status.stateBytes});
   }
   const boundaries=[];
   for(const [prompt,limit,reason] of [['Hello',0,'token limit'],['Hello, world!',3,'context limit'],['<|endoftext|>',3,'eos']]){
    const before=requests.length;
    await execute(f.source.replace(/^use "[^\n]+\n/gm,'').replace('Prompt = "Hello"','Prompt = '+JSON.stringify(prompt)).replace('MaxNew = 3','MaxNew = '+limit));
    if(await scalar('StopReason')!==reason||requests.length!==before)throw Error('Boundary '+reason);
    boundaries.push(reason);
   }
   if(requests.some(r=>r.action==='readState'))throw Error('Cache entered JavaScript');
   return {text:f.reference.text,tokens:f.reference.tokens,runs,boundaries,valuesCompared:checks.reduce((n,c)=>n+c.values,0),maxError:Math.max(...checks.map(c=>c.maxError)),retainedOutputs:requests.filter(r=>r.retainOutput).length,stateInputsReused:requests.reduce((n,r)=>n+(r.inputStates?.filter(Boolean).length??0),0),cacheReadbackRequests:0};
  }finally{worker.terminate();}
 },fixture);
}
