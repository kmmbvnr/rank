// Generate fixtures using node scripts/mlrank-softmax-check.mjs --android.
async page => {
    const fixtures = __RAM_FIXTURES__;
    const checks = await page.evaluate(async fixtures => {
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
        const checks = [];
        let previousModel;
        for (const { shape, op, input, expected, model } of fixtures) for (let repeat = 0; repeat < 2; repeat++) {
            const result = await invoke(model, input);
            if (result.error) throw Error(result.error);
            if (result.output.length !== expected.length) throw Error('Wrong output size');
            let maxError = 0;
            result.output.forEach((value, i) => {
                const error = Math.abs(value - expected[i]);
                maxError = Math.max(maxError, error);
                if (!Number.isFinite(value) || error > 1e-5 + 1e-5 * Math.abs(expected[i])) throw Error('Mismatch at cell ' + i);
            });
            if (result.cached !== (previousModel === model)) throw Error('Model cache did not follow changed weights');
            const width = shape.at(-1);
            for (let offset = 0; offset < result.output.length; offset += width) {
                const sum = result.output.slice(offset, offset + width).reduce((a, b) => a + b, 0);
                if (Math.abs(sum - 1) >= 1e-5) throw Error('Softmax row must sum to one');
            }
            previousModel = model;
            checks.push({ shape, op, repeat, maxError });
        }
        return checks;
    }, fixtures);
    // Exercise the actual Program → worker → native bridge → shaped result path.
    await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    await page.getByRole('button', { name: 'Terminal commands' }).click();
    await page.getByRole('button', { name: 'GPU Linear', exact: true }).click();
    await page.getByRole('button', { name: 'Terminal commands' }).click();
    await page.getByRole('button', { name: 'Run program', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#screen').textContent.replace(/\s/g, '').includes('38.54351.554'));
    await page.getByRole('button', { name: 'dense.ram', exact: true }).click();
    await page.getByRole('textbox', { name: 'RAM module source' }).fill(
        'use ml\narg X .f32 shape 2 3\nOld = X\nX = X relu\nH = Old softmax\nreturn H');
    await page.getByRole('button', { name: 'Program', exact: true }).click();
    await page.getByRole('button', { name: 'Terminal commands' }).click();
    await page.getByRole('button', { name: 'Run program', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#screen').textContent.includes('0.090030'));
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    await page.getByRole('button', { name: 'dense.ram', exact: true }).click();
    if (!(await page.getByRole('textbox', { name: 'RAM module source' }).inputValue()).includes('H = Old softmax'))
        throw Error('RAM source did not survive reload');
    await page.getByRole('button', { name: 'Program', exact: true }).click();
    return checks;
}
