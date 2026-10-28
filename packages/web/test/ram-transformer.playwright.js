// Generate with node scripts/mlrank-transformer-check.mjs --android.
async page => {
    const fixtures = __RAM_FIXTURES__;
    const checks = await page.evaluate(async fixtures => {
        const checks = [], outputs = new Map(); let previousModel, modelId;
        const send = async request => {
            const id=crypto.randomUUID();
            await window.Capacitor.nativePromise('RamGpu','submit',{id,payload:JSON.stringify(request)});
            return fetch('/__rank_ml_result?id='+id).then(r=>r.json());
        };
        for (const f of fixtures) for(let repeat=0;repeat<6;repeat++) {
            const requests = [], start = performance.now(); let prepareMs = 0;
            const cached = previousModel===f.model;
            if(!cached) {
                const request = {action:'load',model:f.model,inputSizes:f.inputSizes}; requests.push(request);
                const loaded = await send(request);
                if(loaded.error) throw Error(loaded.error);
                modelId=loaded.modelId; prepareMs=loaded.prepareMs;
            }
            const request = {action:'invoke',modelId,input:f.input}; requests.push(request);
            const result = await send(request);
            const wallMs=performance.now()-start;
            if(result.error) throw Error(result.error);
            prepareMs += result.prepareMs;
            previousModel=f.model;
            if(result.output.length!==f.expected.length) throw Error('Wrong output size');
            const errors=result.output.map((x,i)=>Math.abs(x-f.expected[i]));
            errors.forEach((e,i)=>{if(!Number.isFinite(e)||e>1e-5+1e-5*Math.abs(f.expected[i])) throw Error(f.stage+' cell '+i);});
            if(f.stage.endsWith('/Probabilities')) {
                const T=f.outputShape.at(-1);
                for(let row=0;row<result.output.length/T;row++) {
                    const values=result.output.slice(row*T,(row+1)*T);
                    if(Math.abs(values.reduce((a,b)=>a+b,0)-1)>1e-5) throw Error('Probability sum');
                    for(let j=row%T+1;j<T;j++) if(values[j]!==0) throw Error('Future attention');
                }
            }
            if(f.stage.endsWith('/Output')) {
                const key=f.stage.replace('future-changed','base');
                if(f.stage.includes('future-changed')) {
                    const base=outputs.get(key),[B,T,C]=f.inputShape;
                    for(let b=0;b<B;b++) for(let t=0;t<T-1;t++) for(let c=0;c<C;c++) {
                        const i=(b*T+t)*C+c;
                        if(Math.abs(result.output[i]-base[i])>1e-5) throw Error('Future token changed earlier output');
                    }
                } else outputs.set(key,result.output);
            }
            checks.push({stage:f.stage,repeat,maxError:Math.max(...errors),wallMs,prepareMs,
                executeMs:result.executeMs,transportAndSchedulingMs:wallMs-prepareMs-result.executeMs,
                requestBytes:requests.reduce((sum,r)=>sum+new TextEncoder().encode(JSON.stringify(r)).length,0),
                actions:requests.map(r=>r.action), modelTransmissions:requests.filter(r=>r.model).length,modelBytes:atob(f.model).length});
        }
        await send({action:'release',modelId});
        const stale=await send({action:'invoke',modelId,input:fixtures[0].input});
        if(stale.code!=='STALE_MODEL') throw Error('Released handle still usable');
        return checks;
    },fixtures);
    return checks;
}
