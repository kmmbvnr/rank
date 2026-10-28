// Substitute __EMBEDDING_FIXTURE__ with the fixture emitted by the desktop check.
async page => {
 const fixture=__EMBEDDING_FIXTURE__;
 return page.evaluate(async f=>{
  const main=document.querySelector('script[type="module"][src]').src,code=await fetch(main).then(r=>r.text());
  const worker=new Worker(new URL(code.match(/worker-[A-Za-z0-9_-]+\.js/)[0],main),{type:'module'});
  const pending=new Map(),requests=[];let sequence=0,maxError=0;
  worker.onmessage=event=>{const m=event.data;if(m.ram){requests.push(JSON.parse(m.ram.payload));void window.Capacitor.nativePromise('RamGpu','submit',m.ram).catch(e=>{for(const p of pending.values())p.reject(e);});return;}const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m);}};
  const post=(message,id)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Embedding timeout')),60000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});worker.postMessage(message);});
  const call=(method,args)=>{const id=++sequence;return post({id,method,args},id);};
  const raw=async request=>{const id=crypto.randomUUID();await window.Capacitor.nativePromise('RamGpu','submit',{id,payload:JSON.stringify(request)});return fetch('/__rank_ml_result?id='+id).then(r=>r.json());};
  const check=(values,expected)=>{if(values.length!==expected.length)throw Error('Wrong shape');values.forEach((v,i)=>{const e=Math.abs(v-expected[i]);maxError=Math.max(maxError,e);if(e>1e-6)throw Error('Wrong value '+i);});};
  try{
   await post({nativeRam:true,modules:{'embedding.ram':f.ram}},0);
   const run=await call('execute',[f.source,1,f.source.split('\n')]);if(!run.result.ok)throw Error(JSON.stringify(run.result));
   const values=[];for(let row=0;row<4;row++)for(let start=0;start<1024;start+=256){const v=await call('inspect',[run.result.valueRef,{offset:[row,start],count:[1,256]}]);values.push(...v.result.cells.flat().map(c=>Number(c.text)));}check(values,f.cases[1].expected);
   const invokes=requests.filter(r=>r.action==='invoke'),loads=requests.filter(r=>r.action==='load');
   if(invokes.length!==2||loads.length!==1||JSON.stringify(loads[0].inputDtypes)!==JSON.stringify(['f32','i32','f32','i32']))throw Error('Typed load mismatch');
   const profiles=[];
   for(let i=0;i<2;i++){
    if(JSON.stringify(invokes[i].input)!==JSON.stringify([...f.cases[i].ids,...f.cases[i].positions]))throw Error('Integer transport mismatch');
    const {output,...p}=await raw({...invokes[i],profile:true});if(p.error)throw Error(p.error);check(output,f.cases[i].expected);if(p.fileBytesRead!==0||p.fileInputsReused!==2)throw Error('Weights not reused');profiles.push(p);
   }
   const bad=await raw({...invokes[0],input:[1.5,...invokes[0].input.slice(1)]});if(!bad.error?.includes('32-bit'))throw Error('Fractional native index accepted');
   const count=requests.filter(r=>r.action==='invoke').length;
   const invalid=f.source.replace('use "embedding.ram"\n','').replace('array 7 2047 7 0','array 7 2048 7 0');
   const rejected=await call('execute',[invalid,1,invalid.split('\n')]);if(rejected.result.ok||!JSON.stringify(rejected).includes('gather index')||requests.filter(r=>r.action==='invoke').length!==count)throw Error('Index bounds not checked before GPU: '+JSON.stringify({rejected,count,after:requests.filter(r=>r.action==='invoke').length}));
   await raw({action:'release',modelId:invokes[0].modelId});
   return {workerGpuCalls:2,profileGpuCalls:2,modelLoads:1,valuesCompared:12288,maxError,profiles,invalidIndicesRejected:true};
  }finally{worker.terminate();}
 },fixture);
}
