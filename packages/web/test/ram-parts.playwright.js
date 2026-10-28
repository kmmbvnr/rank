// Substitute __PARTS_FIXTURE__ with parts-fixture.json from mlrank-parts-check.mjs.
async page => {
    const fixture=__PARTS_FIXTURE__;
    return page.evaluate(async f=>{
        const main=document.querySelector('script[type="module"][src]').src,code=await fetch(main).then(r=>r.text());
        const worker=new Worker(new URL(code.match(/worker-[A-Za-z0-9_-]+\.js/)[0],main),{type:'module'});
        const pending=new Map(),requests=[];let sequence=0,maxError=0;
        worker.onmessage=event=>{const m=event.data;if(m.ram){requests.push(JSON.parse(m.ram.payload));void window.Capacitor.nativePromise('RamGpu','submit',m.ram).catch(e=>{for(const p of pending.values())p.reject(e);});return;}const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m);}};
        const post=(message,id)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Parts worker timeout')),60000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});worker.postMessage(message);});
        const call=(method,args)=>{const id=++sequence;return post({id,method,args},id);};
        const raw=async request=>{const id=crypto.randomUUID();await window.Capacitor.nativePromise('RamGpu','submit',{id,payload:JSON.stringify(request)});return fetch('/__rank_ml_result?id='+id).then(r=>r.json());};
        const send=async request=>{const r=await raw(request);if(r.error)throw Error(r.error);return r;};
        const check=(values,expected,factor=1)=>{if(values.length!==expected.length)throw Error('Wrong shape');values.forEach((v,i)=>{const e=Math.abs(v-expected[i]*factor);maxError=Math.max(maxError,e);if(e>1e-4+Math.abs(expected[i]*factor)*1e-4)throw Error('Wrong value '+i);});};
        const profiles=[];
        const reuse=async(request,expected)=>{const {output,...profile}=await send({...request,profile:true});check(output,expected);if(profile.fileBytesRead!==0||profile.fileInputsReused!==1)throw Error('Weights not resident');profiles.push(profile);};
        const execute=async source=>{
            const run=await call('execute',[source,1,source.split('\n')]);if(!run.result.ok)throw Error(JSON.stringify(run.result));
            const values=[];for(let start=0;start<2304;start+=256){const v=await call('inspect',[run.result.valueRef,{offset:[0,start],count:[1,256]}]);values.push(...v.result.cells.flat().map(c=>Number(c.text)));}check(values,f.expected);
        };
        try{
            await post({nativeRam:true,modules:f.modules},0);
            const literal=v=>Number.isInteger(v)?v+'.0':String(v);
            const source=f.source.replace('F =',`X = array shape 1 768\n${f.x.map(literal).join(' ')}\nend\nF =`);
            await execute(source);
            let invokes=requests.filter(r=>r.action==='invoke');
            if(invokes.length!==6||requests.filter(r=>r.action==='load').length!==2)throw Error('Parts were reloaded during alternation');
            if(invokes.some(r=>r.input.length!==768||r.inputFiles.filter(Boolean).length!==1))throw Error('Weights crossed JSON');
            const graph=f.graphs['partscale.ram'];
            const denied=await raw({action:'load',...graph,reservationBytes:128*1024*1024+1});if(!denied.error?.includes('budget'))throw Error('Oversized reservation accepted');
            await reuse(invokes[0],f.scaled);await reuse(invokes[1],f.expected);
            const pressure=await send({action:'load',...graph,reservationBytes:128*1024*1024});
            if(pressure.cacheEvictions!==2||pressure.residentModels!==1)throw Error('Budget eviction failed');
            await execute(source.replace('use "partscale.ram"\n','').replace('use "partqkv.ram"\n',''));
            if(requests.filter(r=>r.action==='load').length!==4)throw Error('Stale parts were not recovered');
            invokes=requests.filter(r=>r.action==='invoke');
            const a=invokes.at(-2),b=invokes.at(-1);
            await reuse(a,f.scaled);await reuse(b,f.expected);
            const releasedA=await send({action:'release',modelId:a.modelId});if(releasedA.residentModels!==1)throw Error('Individual release failed');
            if((await raw(a)).code!=='STALE_MODEL')throw Error('Released handle accepted');
            await reuse(b,f.expected);
            await send({action:'release',modelId:b.modelId});
            const ids=[];let finalLoad;
            for(let i=0;i<5;i++){finalLoad=await send({action:'load',...graph});ids.push(finalLoad.modelId);}
            if(finalLoad.residentModels!==4||finalLoad.cacheEvictions!==1||(await raw({action:'invoke',modelId:ids[0],input:[]})).code!=='STALE_MODEL')throw Error('Model count cap failed');
            let released;for(const modelId of ids)released=await send({action:'release',modelId});
            if(released.residentModels!==0||released.residentBytes!==0)throw Error('Resources not released');
            return {parts:2,workerGpuCalls:12,workerLoads:4,staleRecoveries:2,maxError,valuesCompared:2*2304+2*768+3*2304,pressure,profiles,countLimitVerified:true,releasedAll:true};
        }finally{worker.terminate();}
    },fixture);
}
