import { expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { ownedArray, readArrayItem } from '../src/array-storage.js';
import { native } from '../src/modules/shared.js';

it('finishes opaque input reads before evaluating the modulus', () => {
    const runtime = new Interpreter();
    const trace: string[] = [];
    try {
        runtime.variables.set('V', ownedArray([10n, 20n]));
        runtime.variables.set('K', { kind: 'array', shape: [2], items: [], itemAt: i => {
            trace.push(`key${i}`); return 0n;
        } });
        runtime.variables.set('modulus', native('modulus', 1, () => { trace.push('mod'); return 7n; }));
        const result = runtime.execute('(V reduce + by K) mod (0 modulus)');
        expect(trace).toEqual(['key0', 'key1', 'mod']);
        if (result === undefined || !isRankArray(result)) throw new Error('expected array');
        expect(readArrayItem(result, 0)).toBe(2n);
    } finally { runtime.dispose(); }
});
it('captures the grouped result before modulus effects mutate its input', () => {
    const runtime = new Interpreter();
    const source = ownedArray([10n, 20n]);
    try {
        runtime.variables.set('V', source);
        runtime.variables.set('K', ownedArray([0n, 0n]));
        runtime.variables.set('modulus', native('modulus', 1, () => { source.items[0] = 999n; return 7n; }));
        const result = runtime.execute('(V sum by K) mod (0 modulus)');
        if (result === undefined || !isRankArray(result)) throw new Error('expected array');
        expect(readArrayItem(result, 0)).toBe(2n);
    } finally { runtime.dispose(); }
});
it('reads a named modulus after opaque key effects', () => {
    const runtime = new Interpreter();
    try {
        runtime.variables.set('V', ownedArray([10n, 20n]));
        runtime.variables.set('Mod', 7n);
        runtime.variables.set('K', { kind: 'array', shape: [2], items: [], itemAt: () => {
            runtime.variables.set('Mod', 11n); return 0n;
        } });
        const result = runtime.execute('(V reduce + by K) mod Mod');
        if (result === undefined || !isRankArray(result)) throw new Error('expected array');
        expect(readArrayItem(result, 0)).toBe(8n);
    } finally { runtime.dispose(); }
});
