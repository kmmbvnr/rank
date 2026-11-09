import { expect, it } from 'vitest';
import { isRankArray, type RankValue } from '../src/index.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';
import { compileNativeTensorCopy, type TensorCodeCache, type TensorNode } from '../src/jit/tensor-kernel.js';

it('reuses numeric gather code while binding each broadcast geometry separately', () => {
    const table: TensorNode = { kind: 'input', name: 'Table' };
    const rows: TensorNode = { kind: 'input', name: 'Rows' };
    const columns: TensorNode = { kind: 'input', name: 'Columns' };
    const selector: TensorNode = { kind: 'binary', op: '+', left: rows, right: columns };
    const root: TensorNode = { kind: 'select', source: table, selector };
    const domains = new Map([table, rows, columns, selector, root].map(node => [node, ['integer'] as const]));
    const code: TensorCodeCache = new Map();
    const inputs = new Map<string, RankValue>();
    const compiled = compileNativeTensorCopy(root, domains,
        { lookup: name => inputs.get(name), builtin: () => true }, code)!;
    let numeric: unknown;
    for (let width = 2; width < 45; width++) {
        const height = 48 - width;
        const values = Int32Array.from({ length: 4096 }, (_, i) => i * 3);
        inputs.set('Table', typedArray(values));
        inputs.set('Rows', typedArray(Int32Array.from({ length: height }, (_, i) => i * 64), [height, 1]));
        inputs.set('Columns', typedArray(Int32Array.from({ length: width }, (_, i) => i), [1, width]));
        const result = compiled.run();
        expect(result !== undefined && isRankArray(result)).toBe(true);
        if (result === undefined || !isRankArray(result)) throw Error('expected array');
        expect(result.shape).toEqual([height, width]);
        expect(Array.from({ length: height * width }, (_, i) => readArrayItem(result, i)))
            .toEqual(Array.from({ length: height * width }, (_, i) => BigInt((Math.floor(i / width) * 64 + i % width) * 3)));
        const runners = [...code].filter(([source]) => source.includes('/* number '));
        expect(runners).toHaveLength(1);
        numeric ??= runners[0][1];
        expect(runners[0][1]).toBe(numeric);
        expect(code.size).toBeLessThanOrEqual(32);
    }
    // Changing representation after warmup must still replay wide cells exactly.
    const wide = 9007199254740993n;
    inputs.set('Table', typedArray(new BigInt64Array(4096).fill(wide)));
    const result = compiled.run();
    expect(result !== undefined && isRankArray(result)).toBe(true);
    if (result === undefined || !isRankArray(result)) throw Error('expected array');
    expect(readArrayItem(result, 0)).toBe(wide);
    expect(readArrayItem(result, result.shape[0] * result.shape[1] - 1)).toBe(wide);
});
