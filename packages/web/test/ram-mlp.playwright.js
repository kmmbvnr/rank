// Generate with node scripts/mlrank-mlp-check.mjs --android.
async page => {
    const fixtures = __RAM_FIXTURES__;
    const checks = await page.evaluate(async fixtures => {
        const checks = []; let previousModel;
        for (const f of fixtures) for(let repeat=0;repeat<6;repeat++) {
            const payload = JSON.stringify({model:f.model,input:f.input});
            const start = performance.now(), id=crypto.randomUUID();
            await window.Capacitor.nativePromise('RamGpu','submit',{id,payload});
            const result=await fetch('/__rank_ml_result?id='+id).then(r=>r.json());
            const wallMs=performance.now()-start;
            if(result.error) throw Error(result.error);
            if(result.cached !== (previousModel===f.model)) throw Error('Wrong cache state');
            previousModel=f.model;
            if(result.output.length!==f.expected.length) throw Error('Wrong output size');
            const errors=result.output.map((x,i)=>Math.abs(x-f.expected[i]));
            errors.forEach((e,i)=>{if(!Number.isFinite(e)||e>1e-5+1e-5*Math.abs(f.expected[i])) throw Error(f.stage+' cell '+i);});
            if(f.stage==='Logits softmax') for(let i=0;i<result.output.length;i+=2) {
                if(Math.abs(result.output[i]+result.output[i+1]-1)>1e-5) throw Error('Probability sum');
                if((result.output[i+1]>result.output[i])!==(f.expected[i+1]>f.expected[i])) throw Error('Class mismatch');
            }
            checks.push({stage:f.stage,repeat,maxError:Math.max(...errors),wallMs,prepareMs:result.prepareMs,
                executeMs:result.executeMs,transportAndSchedulingMs:wallMs-result.prepareMs-result.executeMs,
                requestBytes:new TextEncoder().encode(payload).length,modelBytes:atob(f.model).length});
        }
        return checks;
    },fixtures);
    await page.waitForFunction(()=>!document.querySelector('#brand').disabled);
    await page.getByRole('button',{name:'Terminal commands'}).click();
    await page.getByRole('button',{name:'GPU MLP',exact:true}).click();
    const run = async () => {
        await page.getByRole('button',{name:'Terminal commands'}).click();
        await page.getByRole('button',{name:'Run program',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('#screen').textContent.includes('0.982013'));
    };
    await run();
    await page.reload();
    await page.waitForFunction(()=>!document.querySelector('#brand').disabled);
    await page.getByRole('button',{name:'classifier.ram',exact:true}).click();
    const source=await page.getByRole('textbox',{name:'RAM module source'}).inputValue();
    if(source.trim()!==fixtures[0].source.trim()) throw Error('MLP did not survive reload');
    await page.getByRole('button',{name:'Program',exact:true}).click();
    await run();
    return checks;
}
