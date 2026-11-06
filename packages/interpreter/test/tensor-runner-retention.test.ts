import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('cached Number tensor variants release their previous input buffers', () => {
    const index = new URL('../out/index.js', import.meta.url).href;
    const storage = new URL('../out/array-storage.js', import.meta.url).href;
    const compiler = new URL('../out/tensor-kernel.js', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import { setImmediate } from 'node:timers/promises';
        import { parse } from ${JSON.stringify(index)};
        import { typedArray, readArrayItem } from ${JSON.stringify(storage)};
        import { compileTensorKernel } from ${JSON.stringify(compiler)};
        const values = new Map(), references = [];
        const kernel = compileTensorKernel(parse('Result = (Source mod 7 + 1) copy').statements[0], {
            lookup: name => values.get(name), builtin: () => true,
        });
        function call(size) {
            const cells = new BigInt64Array(size).fill(2n ** 40n);
            references.push(new WeakRef(cells.buffer));
            values.set('Source', typedArray(cells, [size]));
            const result = kernel.run();
            assert.equal(readArrayItem(result, size - 1), (2n ** 40n) % 7n + 1n);
        }
        for (const size of [10000, 20000, 30000]) call(size);
        values.clear();
        for (let turn = 0; turn < 4; turn++) { await setImmediate(); global.gc(); }
        assert.equal(references.filter(reference => reference.deref() !== undefined).length, 0,
            'cached tensor runners retain input buffers');
        call(10000);
    `], { encoding: 'utf8', timeout: 20000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
});
