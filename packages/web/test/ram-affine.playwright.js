// Generate output/playwright/ram-affine.js with scripts/mlrank-android-fixtures.mjs,
// then run that file through playwright-cli attached to the Android WebView.
async page => {
    const fixtures = __RAM_FIXTURES__;
    await page.evaluate(async fixtures => {
        const input = Array.from({ length: 4096 }, (_, i) => Math.fround((i - 2048) / 7));
        for (const { scale, model } of fixtures) for (let repeat = 0; repeat < 2; repeat++) {
            const id = crypto.randomUUID();
            await window.Capacitor.nativePromise('RamGpu', 'submit', { id, payload: JSON.stringify({ model, input }) });
            const result = await fetch('/__rank_ml_result?id=' + id).then(response => response.json());
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
