import { expect, it } from 'vitest';
import { modularInputsQuad } from '../src/modular-power.js';
import { modularPower } from '../src/primality.js';
import { powerStoredInt32 } from '../src/jit/integer-array-kernel.js';
import { typedArray } from '../src/array-storage.js';
import { Interpreter, RuntimeDiagnostics, isRankArray } from '../src/index.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

it('matches exact powers for four independent signed bases and wide exponents', () => {
    let seed = 570;
    const next = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const special = [0, 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 10 ** 12, Number.MAX_SAFE_INTEGER];
    for (let sample = 0; sample < 256; sample++) {
        const bases = Array.from({ length: 4 }, (_, i) => (i % 2 ? -1 : 1) * (next() * 1048576 + next() % 1048576));
        const exponents = Array.from({ length: 4 }, (_, i) => special[(sample + i) % special.length]);
        const moduli = Array.from({ length: 4 }, (_, i) => sample === 0 ? [1, 2, 2 ** 30 - 1, 2 ** 30][i] : 1 + next() % (2 ** 30));
        const out = new Float64Array(6).fill(-1);
        modularInputsQuad(bases[0], bases[1], bases[2], bases[3], ...exponents as [number, number, number, number], ...moduli as [number, number, number, number], out, 1);
        expect([...out.slice(1, 5)]).toEqual(exponents.map((e, i) => Number(modularPower(BigInt(bases[i]), BigInt(e), BigInt(moduli[i])))));
        expect(out[0]).toBe(-1); expect(out[5]).toBe(-1);
    }
});
it.each([1, 3, 4, 5, 4095, 4096, 4097])('handles stored triples and tails of length %s', size => {
    const bases = BigInt64Array.from({ length: size }, (_, i) => BigInt(i % 2 ? -9007199254740991 + i : i + 4));
    const exponents = BigInt64Array.from({ length: size }, (_, i) => 4294967296n + BigInt(i));
    const moduli = Int32Array.from({ length: size }, (_, i) => 1 + i % 997);
    const d = new RuntimeDiagnostics();
    const result = d.run(() => powerStoredInt32(typedArray(bases), typedArray(exponents), typedArray(moduli)));
    expect(result).toBeDefined(); expect(d.nativeModularPowerTriples).toBe(1);
    expect([...result!.items]).toEqual(Array.from(exponents, (e, i) => modularPower(bases[i], e, BigInt(moduli[i]))));
});
it.each(['budget', 'interrupt', 'shared', 'opaque'])('retains ordinary evaluation with %s operands', mode => {
    const bases = typedArray(mode === 'shared' ? new Int32Array(new SharedArrayBuffer(16)).fill(3) : Int32Array.of(2, 3, 4, 5));
    const exponents = typedArray(Int32Array.of(1, 2, 3, 4)), moduli = typedArray(Int32Array.of(3, 5, 7, 11));
    let reads = 0;
    if (mode === 'opaque') Object.defineProperty(bases, 'itemAt', { value: () => { reads++; return 3n; } });
    const run = () => powerStoredInt32(bases, exponents, moduli);
    const value = mode === 'budget' ? withDemandBudget(100000, run) : mode === 'interrupt' ? withInterrupt(new Int32Array(1), run) : run();
    expect(value).toBeUndefined(); expect(reads).toBe(0);
});
it('declines unsafe bases and exponents and invalid domains before publishing an array', () => {
    for (const [b, e, m] of [[9007199254740993n, 2n, 97], [2n, 9007199254740993n, 97], [2n, -1n, 97], [2n, 3n, 0]] as const) {
        expect(powerStoredInt32(typedArray(BigInt64Array.of(2n, b)), typedArray(BigInt64Array.of(1n, e)), typedArray(Int32Array.of(3, m)))).toBeUndefined();
    }
});
it('retains public empty results and broadcast shapes', () => {
    const r = new Interpreter(() => {}), d = new RuntimeDiagnostics();
    try {
        r.execute('use numbers');
        const empty = r.execute('Values = array shape 0 fill 0\nValues Values Values powmod');
        expect(isRankArray(empty!) && [...empty.items]).toEqual([]);
        r.variables.set('B', typedArray(Int32Array.of(-3, 5), [2, 1]));
        r.variables.set('E', typedArray(BigInt64Array.of(0n, 4294967297n, 17n), [1, 3]));
        r.variables.set('M', typedArray(Int32Array.of(1, 2, 97, 101, 1073741824, 1073741825), [2, 3]));
        const value = d.run(() => r.execute('Result = array shape 2 3 fill 0\nfor Once in 1 to 1\n Result = B E M powmod\nend\nResult'));
        if (!value || !isRankArray(value)) throw Error('expected array');
        expect(value.shape).toEqual([2, 3]);
        expect([...value.items]).toEqual([-3n, 5n].flatMap((b, i) => [0n, 4294967297n, 17n].map((e, j) => modularPower(b, e, BigInt([1, 2, 97, 101, 1073741824, 1073741825][i * 3 + j])))));
        expect(d.compiledModularPowers).toBeGreaterThan(0);
    } finally { r.dispose(); }
});
it('preserves wide output storage when a later group uses the compact kernel', () => {
    const r = new Interpreter(() => {}), d = new RuntimeDiagnostics();
    const b = [9007199254740991n, 1000003n, -7n, 4n, 5n, 6n, 7n, 8n], e = [13n, 5n, 4294967297n, 17n, 9n, 10n, 11n, 12n];
    const m = [5000000000000n, 97n, 1073741825n, 101n, 13n, 17n, 19n, 23n];
    try {
        r.execute('use numbers');
        r.variables.set('B', typedArray(BigInt64Array.from(b))); r.variables.set('E', typedArray(BigInt64Array.from(e))); r.variables.set('M', typedArray(BigInt64Array.from(m)));
        const value = d.run(() => r.execute('Result = array shape 8 fill 0\nfor Once in 1 to 1\n Result = B E M powmod\nend\nResult'));
        if (!value || !isRankArray(value)) throw Error('expected array');
        expect([...value.items]).toEqual(e.map((x, i) => modularPower(b[i], x, m[i])));
        expect(d.compiledModularPowers).toBeGreaterThan(0);
    } finally { r.dispose(); }
});
it.each([false, true])('publishes preceding writes once on a domain error (compiled=%s)', compilation => {
    const r = new Interpreter(() => {}, { compilation });
    try {
        r.execute('use numbers\nB = array 2 3 4 5\nE = array 1 -1 3 4\nM = array 3 5 7 11\nCount = 0\nResult = array 0');
        expect(() => r.execute('for Once in 1 to 1\n Count += 1\n Result = B E M powmod\nend')).toThrow(/nonnegative/);
        expect(r.variables.get('Count')).toBe(1n);
        expect(r.execute('Result 0')).toBe(0n);
    } finally { r.dispose(); }
});
it('does not execute a batch in an unvisited branch', () => {
    const r = new Interpreter(() => {}), d = new RuntimeDiagnostics();
    try {
        r.execute('use numbers\nB = array 2 3 4 5\nE = array -1 -1 -1 -1\nM = array 0 0 0 0\nResult = array 7');
        d.run(() => r.execute('for Once in 1 to 1\n if false\n  Result = B E M powmod\n end\nend'));
        expect(r.execute('Result 0')).toBe(7n); expect(d.compiledModularPowers).toBe(0);
    } finally { r.dispose(); }
});
it('retains exact stored triples across compact modulus groups and wide scalar fallbacks', () => {
    const b = BigInt64Array.of(-9007199254740991n, 9007199254740991n, 4n, 5n, 6n);
    const e = BigInt64Array.of(4294967297n, 17n, 0n, 11n, 13n);
    const m = Int32Array.of(2147483647, 1073741825, 1, 1073741824, 97);
    const result = powerStoredInt32(typedArray(b), typedArray(e), typedArray(m));
    expect(result).toBeDefined();
    expect([...result!.items]).toEqual(Array.from(e, (x, i) => modularPower(b[i], x, BigInt(m[i]))));
});
it.each(['budget', 'interrupt', 'inspection'])('keeps compiled powmod checkpoints observable with %s', mode => {
    const r = new Interpreter(() => {}), d = new RuntimeDiagnostics();
    try {
        r.execute('use numbers\nB = array 2 3 4 5\nE = array 1 2 3 4\nM = array 3 5 7 11\nResult = array 0');
        const execute = () => d.run(() => r.execute('for Once in 1 to 1\n Result = B E M powmod\nend\nResult'));
        const value = mode === 'budget' ? withDemandBudget(100000, execute)
            : withInterrupt(new Int32Array(1), execute, mode === 'inspection' ? () => {} : undefined);
        if (!value || !isRankArray(value)) throw Error('expected array');
        expect([...value.items]).toEqual([2n, 4n, 1n, 9n]);
        expect(d.compiledModularPowers).toBe(0);
    } finally { r.dispose(); }
});
