// Substitute __GPT2_BLOCK_FIXTURE__ with block-fixture.json from the desktop check.
async page => {
 const fixture=__GPT2_BLOCK_FIXTURE__;
 return page.evaluate(async f=>{
  const main=document.querySelector('script[type="module"][src]').src;
  const code=await fetch(main).then(r=>r.text());
  const url=new URL(code.match(/worker-[A-Za-z0-9_-]+\.js/)[0],main);
  const checks=[],profiles=[];
  const check=(values,expected,label)=>{
   if(values.length!==expected.length)throw Error('Wrong length: '+label);
   let maxError=0;values.forEach((v,i)=>{const e=Math.abs(v-expected[i]);maxError=Math.max(maxError,e);if(!Number.isFinite(v)||e>5e-4+Math.abs(expected[i])*1e-4)throw Error(label+' '+i+': '+v+' != '+expected[i]);});
   checks.push({label,values:values.length,maxError});
   if(label==='Probabilities')for(let at=0;at<values.length;at+=4){if(Math.abs(values.slice(at,at+4).reduce((a,b)=>a+b,0)-1)>1e-5)throw Error('Softmax sum');for(let j=(at/4)%4+1;j<4;j++)if(values[at+j]!==0)throw Error('Future token visible');}
  };
  const raw=async request=>{const id=crypto.randomUUID();await window.Capacitor.nativePromise('RamGpu','submit',{id,payload:JSON.stringify(request)});const reply=await fetch('/__rank_ml_result?id='+id).then(r=>r.json());if(reply.error)throw Error(reply.error);return reply;};
  const execute=async (source,modules,expected)=>{
   const worker=new Worker(url,{type:'module'}),pending=new Map(),requests=[];let sequence=0;
   worker.onmessage=event=>{const m=event.data;if(m.ram){requests.push(JSON.parse(m.ram.payload));void window.Capacitor.nativePromise('RamGpu','submit',m.ram).catch(e=>{for(const p of pending.values())p.reject(e);});return;}const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m);}};
   const post=(message,id)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Block timeout')),60000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});worker.postMessage(message);});
   try{
    await post({nativeRam:true,nativeFiles:true,modules},0);
    const id=++sequence,run=await post({id,method:'execute',args:[source,1,source.split('\n')]},id);
    if(!run.result.ok)throw Error(JSON.stringify(run.result));
    const invokes=requests.filter(r=>r.action==='invoke');if(invokes.length!==expected.length)throw Error('GPU call count');
    const outputs=[];
    for(let i=0;i<invokes.length;i++){
     const {output,...p}=await raw({...invokes[i],profile:true});check(output,expected[i].values,expected[i].label);outputs.push(output);profiles.push(p);
     if(p.fileBytesRead!==0)throw Error('Resident weights were reread');
    }
    const values=[];
    if(expected.at(-1).values.length===3072)for(let row=0;row<4;row++)for(let start=0;start<768;start+=256){const id=++sequence,v=await post({id,method:'inspect',args:[run.result.valueRef,{offset:[row,start],count:[1,256]}]},id);values.push(...v.result.cells.flat().map(c=>Number(c.text)));}
    // All normal programs return [4,768]; stage shapes are checked through native results.
    if(expected.at(-1).values.length===3072)check(values,expected.at(-1).values,'worker-return');
    return {outputs,loads:requests.filter(r=>r.action==='load').length};
   }finally{worker.terminate();}
  };
  const literal=values=>'array shape 4 768\n'+values.map(v=>Number.isInteger(v)?v+'.0':String(v)).join(' ')+'\nend';
  const attention='X gpt2attn G1 B1 W QkvBias O OutBias',mlp='H gpt2mlp G2 B2 UpW UpB DownW DownB';
  const changed='X = '+literal(f.cases[1].input)+'\nH = '+attention+'\nResult = '+mlp+'\nF close';
  const expected=[{label:'embedding',values:f.cases[0].input},{label:'attention',values:f.cases[0].stages.Residual1},{label:'output',values:f.cases[0].stages.Output},{label:'changed-attention',values:f.cases[1].stages.Residual1},{label:'changed-output',values:f.cases[1].stages.Output}];
  const full=await execute(f.source.replace('F close',changed),f.modules,expected);
  if(full.loads!==3)throw Error('Expected three resident models');
  if(full.outputs[2].slice(0,2304).some((v,i)=>v!==full.outputs[4][i]))throw Error('Causality changed earlier tokens');
  const prefix=f.source.slice(0,f.source.indexOf('Tokens ='));
  for(const stage of f.stages){
   const modules={...f.modules,[stage.name]:stage.source};
   const source=prefix+(stage.stage==='Activated'?'H':'X')+' = '+literal(stage.input)+'\nResult = '+(stage.stage==='Activated'?mlp:attention)+'\nF close\nResult';
   await execute(source,modules,[{label:stage.stage,values:stage.expected}]);
  }
  return {workerGpuCalls:9,profileGpuCalls:9,checks,valuesCompared:checks.reduce((n,c)=>n+c.values,0),causalityVerified:true,profiles};
 },fixture);
}
