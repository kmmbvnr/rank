// Substitute __PROJECTION_FIXTURE__ with projection-fixture.json from the projection checker.
async page => {
 const fixture=__PROJECTION_FIXTURE__;
 return page.evaluate(async f=>{
  const main=document.querySelector('script[type="module"][src]').src,code=await fetch(main).then(r=>r.text());
  const worker=new Worker(new URL(code.match(/worker-[A-Za-z0-9_-]+\.js/)[0],main),{type:'module'});
  const pending=new Map(),requests=[];let sequence=0,maxError=0;
  worker.onmessage=event=>{const m=event.data;if(m.ram){requests.push(JSON.parse(m.ram.payload));void window.Capacitor.nativePromise('RamGpu','submit',m.ram).catch(e=>{for(const p of pending.values())p.reject(e);});return;}const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m);}};
  const post=(message,id)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Chunks worker timeout')),60000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});worker.postMessage(message);});
  const call=(method,args)=>{const id=++sequence;return post({id,method,args},id);};
  const send=async request=>{const id=crypto.randomUUID();await window.Capacitor.nativePromise('RamGpu','submit',{id,payload:JSON.stringify(request)});const r=await fetch('/__rank_ml_result?id='+id).then(r=>r.json());if(r.error)throw Error(r.error);return r;};
  const check=(values,expected)=>{if(values.length!==expected.length)throw Error('Wrong shape');values.forEach((v,i)=>{const e=Math.abs(v-expected[i]);maxError=Math.max(maxError,e);if(e>1e-5+Math.abs(expected[i])*1e-4)throw Error('Wrong value '+i);});};
  try{
   await post({nativeRam:true,modules:f.modules},0);
   const source=f.source.replace(`X = array shape ${f.plan.inputShape.join(' ')} fill 0.5`, `X = array shape ${f.plan.inputShape.join(' ')}\n${f.x.map(v=>Number.isInteger(v)?v+'.0':String(v)).join(' ')}\nend`);
   const run=await call('execute',[source,1,source.split('\n')]);if(!run.result.ok)throw Error(JSON.stringify(run.result));
   const values=[];for(let row=0;row<f.plan.outputShape[0];row++)for(let start=0;start<f.plan.outputShape[1];start+=256){const v=await call('inspect',[run.result.valueRef,{offset:[row,start],count:[1,256]}]);values.push(...v.result.cells.flat().map(c=>Number(c.text)));}check(values,f.expected);
   const invokes=requests.filter(r=>r.action==='invoke');if(invokes.length!==f.plan.gpuCalls||requests.filter(r=>r.action==='load').length!==Object.keys(f.modules).length)throw Error('Unexpected projection loads or invocations');
   const profiles=[];
   for(const request of invokes){
    const d=request.inputFiles[1],start=(d.offset-(f.tensorOffset??f.headerBytes))/(f.plan.inputShape[1]*4);
    if(request.input.length!==f.plan.inputShape.reduce((a,b)=>a*b,1)||d.length>f.plan.chunkBudgetBytes)throw Error('Slice descriptor or JSON payload incorrect');
    const {output,...profile}=await send({...request,profile:true});check(output,Array.from({length:f.plan.inputShape[0]},(_,t)=>f.expected.slice(t*f.plan.outputShape[1]+start,t*f.plan.outputShape[1]+start+d.shape[0])).flat());profiles.push(profile);
   }
   for(const modelId of new Set(invokes.map(r=>r.modelId)))await send({action:'release',modelId});
   return {plan:f.plan,workerGpuCalls:invokes.length,profileGpuCalls:invokes.length,modelLoads:Object.keys(f.modules).length,valuesCompared:f.expected.length*2,maxError,profiles};
  }finally{worker.terminate();}
 },fixture);
}
