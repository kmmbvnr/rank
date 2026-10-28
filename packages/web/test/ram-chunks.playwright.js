// Substitute __CHUNKS_FIXTURE__ with chunks-fixture.json from the desktop checker.
async page => {
 const fixture=__CHUNKS_FIXTURE__;
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
   await post({nativeRam:true,modules:{'chunkdot.ram':f.ram}},0);
   const source=f.source.replace('F =',`X = array shape 1 8192\n${f.x.map(v=>Number.isInteger(v)?v+'.0':String(v)).join(' ')}\nend\nF =`);
   const run=await call('execute',[source,1,source.split('\n')]);if(!run.result.ok)throw Error(JSON.stringify(run.result));
   const values=[];for(let start=0;start<1024;start+=256){const v=await call('inspect',[run.result.valueRef,{offset:[0,start],count:[1,256]}]);values.push(...v.result.cells.flat().map(c=>Number(c.text)));}check(values,f.expected);
   const invokes=requests.filter(r=>r.action==='invoke');if(invokes.length!==8||requests.filter(r=>r.action==='load').length!==1)throw Error('Expected one graph and eight invocations');
   const profiles=[];
   for(let i=0;i<8;i++){
    const request=invokes[i],d=request.inputFiles[1];
    if(request.input.length!==2048||d.offset!==f.headerBytes+Math.floor(i/2)*8388608||d.length!==8388608)throw Error('Slice descriptor or JSON payload incorrect');
    const {output,...profile}=await send({...request,profile:true});check(output,f.parts[Math.floor(i/2)]);
    if(profile.fileBytesRead!==(i%2?0:8388608)||profile.fileInputsReused!==(i%2?1:0))throw Error('Slice reuse incorrect');profiles.push(profile);
   }
   await send({action:'release',modelId:invokes[0].modelId});
   return {weightBytes:33554432,chunkBytes:8388608,workerGpuCalls:8,profileGpuCalls:8,modelLoads:1,valuesCompared:9216,maxError,profiles};
  }finally{worker.terminate();}
 },fixture);
}
