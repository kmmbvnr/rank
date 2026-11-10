import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isNativeFunction, type RankArray } from '../src/index.js';
import { typedArray, derivedArray } from '../src/array-storage.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';
for (const kind of ['int32', 'int64'] as const) for (const separator of ['', ',', '😀\n']) {
    it(`joins ${kind} cells exactly with ${JSON.stringify(separator)}`, () => {
        const values = kind === 'int32' ? [-2147483648n, -1n, 0n, 2147483647n]
            : [-(1n << 63n), 0n, 9007199254740993n, (1n << 63n) - 1n];
        const cells = kind === 'int32' ? Int32Array.from(values, Number) : BigInt64Array.from(values);
        const r = new Interpreter(() => {}), d = new RuntimeDiagnostics();
        try {
            r.execute('use text'); r.variables.set('Values', typedArray(cells)); r.variables.set('Separator', separator);
            expect(d.run(() => r.execute('Values join Separator'))).toBe(values.map(String).join(separator));
            expect(d.nativeIntegerJoins).toBe(1);
            r.variables.set('Values', derivedArray([values.length], [], i => values[i]));
            expect(d.run(() => r.execute('Values join Separator'))).toBe(values.map(String).join(separator));
            expect(d.nativeIntegerJoins).toBe(1);
        } finally { r.dispose(); }
    });
}
it('joins empty native arrays without changing the empty result', () => {
    const r = new Interpreter(() => {}), d = new RuntimeDiagnostics();
    try {
        r.execute('use text'); r.variables.set('Values', typedArray(new Int32Array()));
        expect(d.run(() => r.execute('Values join ","'))).toBe(''); expect(d.nativeIntegerJoins).toBe(1);
    } finally { r.dispose(); }
});
it.each(['budget', 'interrupt', 'shared'])('retains ordinary joining with %s', mode => {
    const r = new Interpreter(() => {}), d = new RuntimeDiagnostics();
    try {
        r.execute('use text');
        const cells = mode === 'shared' ? new Int32Array(new SharedArrayBuffer(12)) : new Int32Array(3);
        cells.set([2, 0, -3]); r.variables.set('Values', typedArray(cells));
        const run = () => d.run(() => r.execute('Values join ":"'));
        const result = mode === 'budget' ? withDemandBudget(100000, run) : mode === 'interrupt'
            ? withInterrupt(new Int32Array(new SharedArrayBuffer(4)), run) : run();
        expect(result).toBe('2:0:-3'); expect(d.nativeIntegerJoins).toBe(0);
    } finally { r.dispose(); }
});
it('validates separators before borrowing cells', () => {
    const r = new Interpreter(() => {}), d = new RuntimeDiagnostics();
    try {
        r.execute('use text'); r.variables.set('Values', typedArray(new Int32Array([1, 2])));
        expect(() => d.run(() => r.execute('Values join 0'))).toThrow(/separator must be text/);
        expect(d.nativeIntegerJoins).toBe(0);
    } finally { r.dispose(); }
});

it('reads an opaque shape exactly once on the ordinary path', () => {
    const r = new Interpreter(() => {});
    try {
        r.execute('use text');
        const join = r.execute('join');
        if (!join || !isNativeFunction(join)) throw Error('expected join');
        let reads = 0;
        const value: RankArray = { kind: 'array', get shape() { reads++; return [2]; }, items: [1n, 2n] };
        expect(join.call([value, ','])).toBe('1,2');
        expect(reads).toBe(1);
    } finally { r.dispose(); }
});
