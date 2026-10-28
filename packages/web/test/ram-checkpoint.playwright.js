// Substitute __CHECKPOINT_FIXTURE__ with the generated fixture.json.
async page => {
    const fixture=__CHECKPOINT_FIXTURE__,reads=[],hashes=[];
    const onRequest=request=>{
        const url=request.url();if(!url.includes('/__rank_model_file?'))return;
        const name=decodeURIComponent(url.match(/[?&]name=([^&]+)/)?.[1]??'');
        if(url.includes('action=sha256'))hashes.push(name);
        const offset=url.match(/[?&]offset=(\d+)/),count=url.match(/[?&]count=(\d+)/);
        if(offset&&count)reads.push({name,offset:Number(offset[1]),count:Number(count[1])});
    };
    page.on('request',onRequest);
    try{
        const result=await page.evaluate(async f=>{
            const main=document.querySelector('script[type="module"][src]').src,code=await fetch(main).then(r=>r.text());
            const worker=new Worker(new URL(code.match(/worker-[A-Za-z0-9_-]+\.js/)[0],main),{type:'module'});
            const pending=new Map(),requests=[];let sequence=0;
            worker.onmessage=event=>{const m=event.data;if(m.ram){requests.push(JSON.parse(m.ram.payload));void window.Capacitor.nativePromise('RamGpu','submit',m.ram).catch(e=>{for(const p of pending.values())p.reject(e);});return;}const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m);}};
            const post=(message,id)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Checkpoint worker timeout')),60000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});worker.postMessage(message);});
            const call=(method,args)=>{const id=++sequence;return post({id,method,args},id);};
            const send=async request=>{const id=crypto.randomUUID();await window.Capacitor.nativePromise('RamGpu','submit',{id,payload:JSON.stringify(request)});const r=await fetch('/__rank_ml_result?id='+id).then(r=>r.json());if(r.error)throw Error(r.error);return r;};
            let maxError=0;const check=(values,factor=1)=>{if(values.length!==2304)throw Error('Wrong output count');values.forEach((v,i)=>{const e=Math.abs(v-f.expected[i]*factor);maxError=Math.max(maxError,e);if(e>1e-4+Math.abs(f.expected[i]*factor)*1e-4)throw Error('Wrong result '+i);});};
            try{
                await post({nativeRam:true,modules:{'sharded.ram':f.ram}},0);
                const literal=v=>Number.isInteger(v)?v+'.0':String(v);
                const source=f.source.replace('F =',`X = array shape 1 768\n${f.x.map(literal).join(' ')}\nend\nF =`);
                const run=await call('execute',[source,1,source.split('\n')]);if(!run.result.ok)throw Error(JSON.stringify(run.result));
                const viewed=[];
                for(let start=0;start<2304;start+=256){const inspected=await call('inspect',[run.result.valueRef,{offset:[0,start],count:[1,Math.min(256,2304-start)]}]);viewed.push(...inspected.result.cells.flat().map(cell=>Number(cell.text)));}
                check(viewed);
                const invokes=requests.filter(r=>r.action==='invoke');if(invokes.length!==3||invokes.some(r=>r.input.length!==768||r.inputFiles.filter(Boolean).length!==2))throw Error('Wrong file transport');
                const request=invokes.at(-1),profiles=[];
                for(const factor of [1,0.5]){const {output,...profile}=await send({...request,input:f.x.map(v=>v*factor),profile:true});check(output,factor);if(profile.fileBytesRead!==0||profile.fileInputsReused!==2)throw Error('Weights not reused');profiles.push(profile);}
                const bad=await call('execute',[`use io\nF = "models/locked.safetensors.index.json" open\nF verify "${'0'.repeat(64)}"`,1,[]]);
                if(bad.result.ok||!JSON.stringify(bad.result).includes('checksum'))throw Error('Wrong pinned index accepted');
                return {valuesCompared:2304*3,maxError,workerGpuCalls:3,nativeReuseCalls:2,wrongPinRejected:true,profiles};
            }finally{worker.terminate();}
        },fixture);
        for(const r of reads){const limit=fixture.headers[r.name.replace(/^models\//,'')];if(limit&&r.offset+r.count>limit)throw Error('Shard payload entered WebView');}
        if(hashes.length!==4)throw Error('Expected one valid index verification, two shard verifications and one wrong-pin check');
        return {...result,reads,hashes,webViewBytes:reads.reduce((n,r)=>n+r.count,0)};
    }finally{page.off('request',onRequest);}
}
