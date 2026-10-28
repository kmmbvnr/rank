// Substitute __LARGE_CHECKPOINT_FIXTURE__ with the large checker's fixture.json.
async page => {
    const fixture=__LARGE_CHECKPOINT_FIXTURE__,reads=[];
    const handler=request=>{const url=request.url();if(url.includes('/__rank_model_file?')&&url.includes('offset='))reads.push(url);};
    page.on('request',handler);
    try{
        const result=await page.evaluate(async f=>{
            const main=document.querySelector('script[type="module"][src]').src,code=await fetch(main).then(r=>r.text());
            const worker=new Worker(new URL(code.match(/worker-[A-Za-z0-9_-]+\.js/)[0],main),{type:'module'});
            const pending=new Map();let sequence=0;
            worker.onmessage=event=>{const m=event.data;if(m.ram){void window.Capacitor.nativePromise('RamGpu','submit',m.ram);return;}const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m);}};
            const post=(message,id)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Large checkpoint timeout')),60000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});worker.postMessage(message);});
            const call=(method,args)=>{const id=++sequence;return post({id,method,args},id);};
            try{
                await post({nativeRam:true,modules:{'largegpu.ram':f.ram}},0);
                const start=performance.now(),run=await call('execute',[f.source,1,f.source.split('\n')]);
                if(!run.result.ok)throw Error(JSON.stringify(run.result));
                const view=await call('inspect',[run.result.valueRef,{count:[2]}]);
                const values=view.result.cells.flat().map(c=>Number(c.text));
                if(JSON.stringify(values)!=='[2.5,-5]')throw Error('Wrong values');
                return {size:f.size,offset:f.offset,sha256:f.sha256,elapsedMs:performance.now()-start,values,correct:true};
            }finally{worker.terminate();}
        },fixture);
        let bytes=0;
        for(const url of reads){const offset=Number(url.match(/[?&]offset=(\d+)/)[1]),count=Number(url.match(/[?&]count=(\d+)/)[1]);bytes+=count;if(url.includes('name=large.safetensors&')&&offset+count>fixture.headerBytes)throw Error('Payload entered WebView');}
        if(!reads.length)throw Error('Missing file reads');
        return {...result,webViewBytes:bytes};
    }finally{page.off('request',handler);}
}
