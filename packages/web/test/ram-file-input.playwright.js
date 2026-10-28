async page => {
    const fixture=__FILE_INPUT_FIXTURE__;
    const reads=[];
    const onRequest=request=>{const u=new URL(request.url());if(u.pathname==='/__rank_model_file'&&u.searchParams.has('offset')) reads.push({offset:Number(u.searchParams.get('offset')),count:Number(u.searchParams.get('count'))});};
    page.on('request',onRequest);
    try {
        const result=await page.evaluate(async fixture=>{
            const main=document.querySelector('script[type="module"][src]').src,code=await fetch(main).then(r=>r.text());
            const asset=new URL(code.match(/worker-[A-Za-z0-9_-]+\.js/)[0],main).href;
            const worker=new Worker(asset,{type:'module'}),pending=new Map(),requests=[];let sequence=0;
            worker.onmessage=event=>{
                const message=event.data;
                if(message.ram){requests.push(JSON.parse(message.ram.payload));void window.Capacitor.nativePromise('RamGpu','submit',message.ram).catch(error=>{for(const p of pending.values())p.reject(error);});return;}
                const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(Error(message.error)):p.resolve(message);}
            };
            const sendWorker=(message,id)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker timeout')),30000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});worker.postMessage(message);});
            const call=(method,args)=>{const id=++sequence;return sendWorker({id,method,args},id);};
            const send=async request=>{const id=crypto.randomUUID();await window.Capacitor.nativePromise('RamGpu','submit',{id,payload:JSON.stringify(request)});return fetch('/__rank_ml_result?id='+id).then(r=>r.json());};
            try {
                await sendWorker({nativeRam:true,modules:{'mapped.ram':fixture.ram}},0);
                const source='use io\nuse "mapped.ram"\nF = "models/mapped.safetensors" open\nW\' = F tensor "weight"\nResult = W mapped\nF close\nResult';
                const run=await call('execute',[source,1,source.split('\n')]);if(!run.result.ok)throw Error(JSON.stringify(run.result));
                const viewed=await call('inspect',[run.result.valueRef,{count:[fixture.expected.length]}]);
                const values=viewed.result.cells.map(row=>Number(row[0].text));
                const check=values=>{if(values.length!==fixture.expected.length||values.some((v,i)=>v!==fixture.expected[i]))throw Error('Wrong GPU result');};check(values);
                const invoke=requests.find(r=>r.action==='invoke');
                if(invoke.input.length!==0||invoke.inputFiles[0].offset!==fixture.offset)throw Error('Tensor was materialized in JS');
                const descriptor=invoke.inputFiles[0];
                const loaded=await send({action:'load',model:fixture.model,inputSizes:[fixture.expected.length]});if(loaded.error)throw Error(loaded.error);
                for(const change of [{revision:'stale'},{offset:fixture.fileSize},{dtype:'F16'}]) {
                    const reply=await send({action:'invoke',modelId:loaded.modelId,input:[],inputFiles:[{...descriptor,...change}]});
                    if(!reply.error)throw Error('Invalid descriptor accepted');
                }
                for(let i=0;i<2;i++) {const r=await send({action:'invoke',modelId:loaded.modelId,input:[],inputFiles:[descriptor]});if(r.error)throw Error(r.error);check(r.output);}
                await send({action:'release',modelId:loaded.modelId});
                return {gpuCalls:3,valuesCompared:values.length,maxError:0,inputValuesSerialized:0,descriptorBytes:JSON.stringify(descriptor).length,
                    fileSize:descriptor.fileSize,offset:descriptor.offset,staleRangeDtypeRejected:true,viewer:true};
            } finally{worker.terminate();}
        },fixture);
        if(reads.some(r=>r.offset+r.count>fixture.headerBytes))throw Error('File payload read by WebView');
        if(!reads.length)throw Error('No observable header reads');
        return {...result,webViewFileReads:reads,webViewBytes:reads.reduce((n,r)=>n+r.count,0)};
    }finally{page.off('request',onRequest);}
}
