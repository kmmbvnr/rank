import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { denseScalarItems, typedArray } from '../src/array-storage.js';
import { withInterrupt } from '../src/interrupt.js';

describe.each([false, true])('wide stable argsort (compilation=%s)', compilation => {
    it.each([false, true])('preserves exact signed Int64 keys and ties (descending=%s)', descending => {
        const keys = [-(1n << 63n), (1n << 63n) - 1n, -1n, 0n, 1n,
            9007199254740993n, 9007199254740992n, -9007199254740993n,
            -9007199254740992n, 4294967296n, -4294967296n, 2147483648n,
            -2147483649n, 6442450944n, -6442450944n, 1n, 0n, -(1n << 63n)];
        for (let i = 0; i < 300; i++) keys.push(BigInt(i % 19 - 9) * 1099511627776n + BigInt(i % 5));
        const backing = new BigInt64Array(keys.length + 2);
        backing.set(keys, 1);
        const r = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            r.variables.set('Keys', typedArray(backing.subarray(1, -1)));
            diagnostics.run(() => r.execute(`use sequences\nOrder = Keys argsort .${descending ? 'descending' : 'ascending'}\nSorted = Keys Order`));
            const order = keys.map((_, i) => i).sort((a, b) =>
                (keys[a] < keys[b] ? -1 : keys[a] > keys[b] ? 1 : 0) * (descending ? -1 : 1) || a - b);
            expect(Array.from(denseScalarItems(r.variables.get('Order') as RankArray)!)).toEqual(order.map(BigInt));
            expect(Array.from(denseScalarItems(r.variables.get('Sorted') as RankArray)!)).toEqual(order.map(i => keys[i]));
            expect(Array.from(backing.subarray(1, -1))).toEqual(keys);
            expect(diagnostics.numericSorts).toBe(1);
            expect(diagnostics.typedUnpacks).toBe(0);
        } finally { r.dispose(); }
    });

    it('keeps arbitrary precision keys beyond Int64 on the exact fallback', () => {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.execute('use sequences\nKeys = array 1208925819614629174706177 1208925819614629174706176 -1208925819614629174706176\nOrder = Keys argsort');
            expect(r.execute('(Order equal array 2 1 0) and reduce')).toBe(true);
        } finally { r.dispose(); }
    });

    it('retains cooperative polling instead of entering native numeric ordering', () => {
        const r = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            r.variables.set('Keys', typedArray(new BigInt64Array([9007199254740993n, -1n, 9007199254740992n, -1n])));
            diagnostics.run(() => withInterrupt(new Int32Array(new SharedArrayBuffer(4)),
                () => r.execute('use sequences\nOrder = Keys argsort')));
            expect(r.execute('(Order equal array 1 3 2 0) and reduce')).toBe(true);
            expect(diagnostics.numericSorts).toBe(0);
        } finally { r.dispose(); }
    });
});
