import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';

function sum(a: BigInt64Array, b: Int32Array, shape = [a.length], otherShape = shape) {
    const expected = Array.from(a).reduce((total, value, index) => total + value * BigInt(b[index % b.length]), 0n);
    for (const compilation of [false, true]) {
        const r = new Interpreter(() => {}, { compilation }), diagnostics = new RuntimeDiagnostics();
        try {
            r.variables.set('Input', typedArray(a.slice(), shape));
            r.variables.set('Weight', typedArray(b.slice(), otherShape));
            const answer = diagnostics.run(() => r.execute("Values' = Input * Weight\nResult = Values sum"));
            expect(answer).toBe(expected);
            expect(r.variables.get('Result')).toBe(expected);
            if (compilation) {
                expect(diagnostics.numberTensors).toBeGreaterThan(0);
                expect(diagnostics.costs['number-tensor.read-buffer']?.allocatedBytes ?? 0).toBe(0);
            }
        } finally { r.dispose(); }
    }
}
it('keeps wide positive and negative totals exact without a product array', () => {
    sum(new BigInt64Array(8192).fill((1n << 45n) + 7n), new Int32Array(8192).fill(3));
    sum(new BigInt64Array(8192).fill(-((1n << 45n) + 7n)), new Int32Array(8192).fill(3));
});
it('retains cancellation after a prefix leaves Number range', () => {
    const a = BigInt64Array.from({ length: 8192 }, (_, i) => i < 4096 ? 1n << 45n : -(1n << 45n));
    a[a.length - 1] += 7n;
    sum(a, new Int32Array(8192).fill(1));
});
it('spills repeated maximum safe terms exactly', () => {
    sum(new BigInt64Array(4096).fill((1n << 53n) - 1n), new Int32Array(4096).fill(1));
});
it('uses native words for multidimensional broadcasts without a conversion buffer', () => {
    sum(new BigInt64Array(8192).fill((1n << 45n) + 1n), Int32Array.from({ length: 64 }, (_, i) => i % 3 + 1), [128, 64], [64]);
});
it.each(['input', 'product'])('replays exactly after a late unsafe %s', kind => {
    const a = new BigInt64Array(4097).fill(3n), b = new Int32Array(4097).fill(1);
    a[a.length - 1] = kind === 'input' ? (1n << 53n) + 1n : (1n << 52n) + 1n;
    if (kind === 'product') b[b.length - 1] = 3;
    const expected = Array.from(a).reduce((total, value, i) => total + value * BigInt(b[i]), 0n);
    for (const compilation of [false, true]) {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.variables.set('Input', typedArray(a.slice())); r.variables.set('Weight', typedArray(b.slice()));
            expect(r.execute("Values' = Input * Weight\nValues sum")).toBe(expected);
        } finally { r.dispose(); }
    }
});
