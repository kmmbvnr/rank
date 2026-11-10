import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('specialized Number broadcast variants release their previous input buffers', () => {
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
        const kernel = compileTensorKernel(parse('Result = (Source mod 7 + Other) copy').statements[0], {
            lookup: name => values.get(name), builtin: () => true,
        });
        function call(size) {
            const cells = new BigInt64Array(size).fill(2n ** 40n);
            references.push(new WeakRef(cells.buffer));
            values.set('Source', typedArray(cells, [size, 1]));
            values.set('Other', typedArray(new Int32Array([1, 2]), [1, 2]));
            for (let repeat = 0; repeat < 10; repeat++) {
                const result = kernel.run();
                assert.equal(readArrayItem(result, size * 2 - 1), (2n ** 40n) % 7n + 2n);
            }
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

it('cached native word sums release previous input buffers', () => {
    const index = new URL('../out/array-storage.js', import.meta.url).href;
    const operators = new URL('../out/operators.js', import.meta.url).href;
    const maps = new URL('../out/tensor-map.js', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import { setImmediate } from 'node:timers/promises';
        import { typedArray } from ${JSON.stringify(index)};
        import { Operators } from ${JSON.stringify(operators)};
        import { tensorPlanScope, reduceTensorMap } from ${JSON.stringify(maps)};
        const references = [];
        const scope = tensorPlanScope({lookup: () => undefined, builtin: () => true}, () => true, () => {});
        const ops = new Operators(() => {}, () => undefined);
        function call(size) {
            const cells = new BigInt64Array(size).fill(1n << 40n);
            references.push(new WeakRef(cells.buffer));
            scope(() => {
                const mapped = ops.evaluateBinary('*', typedArray(cells), 3n);
                assert.equal(reduceTensorMap(mapped, 'sum'), 3n * (1n << 40n) * BigInt(size));
            });
        }
        for (const size of [10000, 20000, 30000]) call(size);
        for (let turn = 0; turn < 4; turn++) { await setImmediate(); global.gc(); }
        assert.equal(references.filter(reference => reference.deref() !== undefined).length, 0,
            'cached native word sum runners retain input buffers');
        call(10000);
    `], { encoding: 'utf8', timeout: 20000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
});
