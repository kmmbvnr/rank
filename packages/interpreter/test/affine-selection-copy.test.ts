import { expect, it } from 'vitest';
import { derivedArray, readArrayItem, typedArray } from '../src/array-storage.js';
import { materializeSelectedView } from '../src/array-copy.js';
import { registerScalarView } from '../src/integer-view.js';

it.each(['int32', 'int64', 'real'] as const)('copies native affine %s views in both directions', kind => {
    const data = kind === 'int32' ? Int32Array.from({ length: 10000 }, (_, i) => i - 5000)
        : kind === 'int64' ? BigInt64Array.from({ length: 10000 }, (_, i) => (1n << 56n) + BigInt(i))
            : Float64Array.from({ length: 10000 }, (_, i) => i + 0.25);
    const source = typedArray(data);
    for (const stride of [3, -3, 0]) {
        const count = 3000, offset = stride < 0 ? 9999 : 2;
        let addresses = 0;
        const at = (i: number) => { addresses++; return offset + i * stride; };
        const view = registerScalarView(derivedArray([count], [source], i => readArrayItem(source, at(i)), true), source, at,
            { regular: true, linear: () => ({ offset, stride }) });
        const result = materializeSelectedView(view);
        expect(result).toBeDefined();
        expect(addresses).toBeLessThan(10);
        for (let i = 0; i < count; i++) expect(readArrayItem(result!, i)).toBe(readArrayItem(source, offset + i * stride));
    }
});
