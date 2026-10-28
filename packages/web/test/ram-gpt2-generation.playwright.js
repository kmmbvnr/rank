// Substitute __GPT2_GENERATION_FIXTURE__ with generation-fixture.json.
async page => {
 const fixture=__GPT2_GENERATION_FIXTURE__;
 await page.waitForFunction(()=>document.querySelector('#input')?.getAttribute('aria-busy')!=='true',null,{timeout:120000});
 return page.evaluate(async f=>{
  const main=document.querySelector('script[type="module"][src]').src,code=await fetch(main).then(r=>r.text());
  const worker=new Worker(new URL(code.match(/worker-[A-Za-z0-9_-]+\.js/)[0],main),{type:'module'});
  const pending=new Map(),requests=[],checks=[],outputs=[];let sequence=0;
  worker.onmessage=event=>{const m=event.data;if(m.ram){requests.push(JSON.parse(m.ram.payload));void window.Capacitor.nativePromise('RamGpu','submit',m.ram).catch(e=>{for(const p of pending.values())p.reject(e);});return;}const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m);}};
  const post=(message,id)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Generation timeout')),240000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});worker.postMessage(message);});
  const call=(method,args)=>{const id=++sequence;return post({id,method,args},id);};
  const execute=async source=>{const r=await call('execute',[source,1,source.split('\n')]);if(!r.result.ok)throw Error(JSON.stringify(r.result));return r.result;};
  const scalar=async source=>{const result=await execute(source);return (await call('inspect',[result.valueRef,{}])).result.text;};
  const check=(values,expected,label)=>{if(values.length!==expected.length)throw Error('Wrong size '+label);let maxError=0;values.forEach((v,i)=>{const e=Math.abs(v-expected[i]);maxError=Math.max(maxError,e);if(!Number.isFinite(v)||e>5e-4+Math.abs(expected[i])*1e-4)throw Error(label+' '+i+': '+v+' != '+expected[i]);});checks.push({label,values:values.length,maxError});};
  try{
   await post({nativeRam:true,nativeFiles:true,modules:f.modules},0);
   await execute('use io\nuse text\nuse sequences\nConfig = "models/gpt2-tokenizer.json" read');
   for(const c of f.tokenizerReference.cases){
    const ids=c.ids.length?'array '+c.ids.join(' '):'array shape 0 fill 0';
    const code='Text = '+JSON.stringify(c.text)+'\nIds = Text bpeencode Config\n((Ids equal ('+ids+')) all) and ((Ids bpedecode Config) equal '+JSON.stringify(c.decoded)+')';
    if(await scalar(code)!=='true')throw Error('Tokenizer mismatch: '+JSON.stringify(c.text));
   }
   for(let run=0;run<2;run++){
    let source=run?f.source.replace('Padded = array shape 4 fill 50256','Padded = array shape 4 fill 0'):f.source.replace('MaxNew = 3','MaxNew = 4');
    if(run)source=source.replace(/^use "[^\n]+\n/gm,'');
    source=source.replace('for Step in','Trace = array shape 3 50257 fill 0.0\nfor Step in').replace('Next = Logits max .index','Trace Step # = Logits\nNext = Logits max .index').replace('F close\nTokens bpedecode Config','F close\nTrace');
    const result=await execute(source),rows=Array.from({length:3},()=>[]);
    for(let column=0;column<50257;column+=1000){const v=await call('inspect',[result.valueRef,{offset:[0,column],count:[3,Math.min(1000,50257-column)]}]);for(let row=0;row<3;row++)rows[row].push(...v.result.cells[row].map(c=>Number(c.text)));}
    rows.forEach((values,step)=>check(values,f.reference.steps[step].logits,'run-'+run+'-step-'+step));outputs.push(rows);
    if(await scalar('Tokens bpedecode Config')!==f.reference.text)throw Error('Decoded output differs');
    if(await scalar('StopReason')!==(run?'token limit':'context limit'))throw Error('Stop reason differs');
   }
   if(JSON.stringify(outputs[0])!==JSON.stringify(outputs[1]))throw Error('Padding changed real-token logits');
   const gpuCount=()=>requests.filter(r=>r.action==='invoke').length;
   if(gpuCount()!==474)throw Error('Unexpected GPU calls');
   for(const [prompt,limit,reason] of [['Hello',0,'token limit'],['Hello, world!',3,'context limit'],['<|endoftext|>',3,'eos']]){
    const source=f.source.replace(/^use "[^\n]+\n/gm,'').replace('Prompt = "Hello"','Prompt = '+JSON.stringify(prompt)).replace('MaxNew = 3','MaxNew = '+limit);
    await execute(source);if(await scalar('StopReason')!==reason||gpuCount()!==474)throw Error('Boundary failed: '+reason);
   }
   return {tokenizerCases:f.tokenizerReference.cases.length,text:f.reference.text,tokens:f.reference.tokens,generatedTokens:f.reference.steps.map(s=>s.next),workerGpuCalls:gpuCount(),modelLoads:requests.filter(r=>r.action==='load').length,valuesCompared:checks.reduce((n,c)=>n+c.values,0),checks,paddingInvariant:true,stopConditionsVerified:true};
  }finally{worker.terminate();}
 },fixture);
}
