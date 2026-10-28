// Exercises the shipped Android worker and the same paging API used by the array viewer.
async page => page.evaluate(async () => {
    const main = document.querySelector('script[type="module"][src]').src;
    const code = await fetch(main).then(r=>r.text());
    const asset = new URL(code.match(/worker-[A-Za-z0-9_-]+\.js/)[0],main).href;
    const worker = new Worker(asset,{type:'module'});
    let sequence=0;
    const pending=new Map();
    worker.onmessage=event=>{const p=pending.get(event.data.id);if(p){pending.delete(event.data.id);event.data.error?p.reject(Error(event.data.error)):p.resolve(event.data);}};
    const send=(message,id)=>new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(id);reject(Error('Worker timeout'));},30000);
        pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
        worker.postMessage(message);
    });
    const call=(method,args)=>{const id=++sequence;return send({id,method,args},id);};
    try {
        await send({nativeRam:true},0);
        const source='use io\nF = "models/large.safetensors" open\nW\' = F tensor "weight"\nW';
        const run=await call('execute',[source,1,source.split('\n')]);
        if(!run.result.ok) throw Error(JSON.stringify(run.result));
        const view=await call('inspect',[run.result.valueRef,{count:[2,3]}]);
        const values=view.result.cells.flat().map(c=>Number(c.text));
        if(JSON.stringify(values)!=='[1,-2,3,4,5,6]') throw Error('Wrong viewed cells '+JSON.stringify(view));
        const big=await call('execute',['P\' = F tensor "padding"\nP',2,[]]);
        if(!big.result.ok) throw Error(JSON.stringify(big.result));
        const tail=await call('inspect',[big.result.valueRef,{offset:[2147483648],count:[2]}]);
        if(tail.result.cells.length!==2 || tail.result.cells.some(row=>row[0].text!=='0')) throw Error('Wrong large view window '+JSON.stringify(tail));
        const small=await call('execute',['use sequences\nW sum',3,[]]);
        if(!small.result.ok) throw Error(JSON.stringify(small.result));
        const sum=await call('inspect',[small.result.valueRef]);
        if(sum.result.text!=='17') throw Error('Wrong sum '+JSON.stringify(sum));
        return {worker:true,viewerPaging:true,shape:view.result.shape,values,largeShape:tail.result.shape,largeOffset:tail.result.axes[0].offset,sum:sum.result.text};
    } finally { worker.terminate(); }
})
