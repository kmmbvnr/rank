// Generate output/playwright/ram-affine.js with scripts/mlrank-android-fixtures.mjs,
// then run that file through playwright-cli attached to the Android WebView.
async page => {
    const fixtures = __RAM_FIXTURES__;
    await page.evaluate(async fixtures => {
        let resident, modelId;
        const send = async request => {
            const id = crypto.randomUUID();
            await window.Capacitor.nativePromise('RamGpu','submit',{id,payload:JSON.stringify(request)});
            const result = await fetch('/__rank_ml_result?id='+id).then(r=>r.json());
            if(result.error) throw Error(result.error);
            return result;
        };
        const invoke = async (model,input) => {
            const cached = resident === model;
            if(!cached) { modelId=(await send({action:'load',model})).modelId; resident=model; }
            return {...await send({action:'invoke',modelId,input}),cached};
        };
        const input = Array.from({ length: 4096 }, (_, i) => Math.fround((i - 2048) / 7));
        for (const { scale, model } of fixtures) for (let repeat = 0; repeat < 2; repeat++) {
            const result = await invoke(model, input);
            if (result.error) throw Error(result.error);
            if (result.output.length !== input.length) throw Error('Wrong output size');
            result.output.forEach((value, i) => {
                const expected = Math.max(0, input[i] * scale + 0.5);
                if (Math.abs(value - expected) > 1e-5 + 1e-6 * Math.abs(expected)) throw Error('Mismatch at cell ' + i);
            });
            if (result.cached !== (repeat === 1)) throw Error('Model cache did not follow changed weights');
        }
    }, fixtures);
}
