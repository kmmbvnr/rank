// Generate fixtures using node scripts/mlrank-linear-check.mjs --android.
async page => {
    const fixtures = __RAM_FIXTURES__;
    const checks = await page.evaluate(async fixtures => {
        const checks = [];
        for (const { m, k, n, change, input, expected, model } of fixtures) for (let repeat = 0; repeat < 2; repeat++) {
            const id = crypto.randomUUID();
            await window.Capacitor.nativePromise('RamGpu', 'submit', { id, payload: JSON.stringify({ model, input }) });
            const result = await fetch('/__rank_ml_result?id=' + id).then(response => response.json());
            if (result.error) throw Error(result.error);
            if (result.output.length !== m * n) throw Error('Wrong output size');
            let maxError = 0;
            result.output.forEach((value, i) => {
                const error = Math.abs(value - expected[i]);
                maxError = Math.max(maxError, error);
                if (!Number.isFinite(value) || error > 1e-5 + 1e-5 * Math.abs(expected[i])) throw Error('Mismatch at cell ' + i);
            });
            if (result.cached !== (repeat === 1)) throw Error('Model cache did not follow changed weights');
            checks.push({ shape: [m, k, n], change, repeat, maxError });
        }
        return checks;
    }, fixtures);
    // Exercise the actual Program → worker → native bridge → shaped result path.
    await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    await page.getByRole('button', { name: 'Terminal commands' }).click();
    await page.getByRole('button', { name: 'GPU Linear', exact: true }).click();
    await page.getByRole('button', { name: 'Terminal commands' }).click();
    await page.getByRole('button', { name: 'Run program', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#screen').textContent.replace(/\s/g, '').includes('38445056'));
    return checks;
}
