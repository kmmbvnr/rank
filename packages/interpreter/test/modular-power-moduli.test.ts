import { expect, it } from 'vitest';
import { modularModuliQuad } from '../src/modular-power.js';
import { modularPower } from '../src/primality.js';
import { powerStoredInt32 } from '../src/jit/integer-array-kernel.js';
import { typedArray } from '../src/array-storage.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

it('matches independent BigInt powers with four varying moduli and wide exponents', () => {
    let seed = 536;
    const next = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const special = [0, 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 10 ** 12, Number.MAX_SAFE_INTEGER];
    for (let sample = 0; sample < 512; sample++) {
        const base = sample % 2 ? -next() : next() * 1048576 + next() % 1048576;
        const exponents = Array.from({ length: 4 }, (_, lane) => special[(sample + lane) % special.length]);
        const moduli = Array.from({ length: 4 }, (_, lane) => sample < 4 ? [1, 2, 2 ** 30 - 1, 2 ** 30][lane] : 1 + next() % (2 ** 30));
        const out = new Int32Array(6).fill(-1);
        modularModuliQuad(base, exponents[0], exponents[1], exponents[2], exponents[3], moduli[0], moduli[1], moduli[2], moduli[3], out, 1);
        expect([...out.slice(1, 5)]).toEqual(exponents.map((e, lane) => Number(modularPower(BigInt(base), BigInt(e), BigInt(moduli[lane])))));
        expect(out[0]).toBe(-1); expect(out[5]).toBe(-1);
    }
});
it.each([0, 1, 3, 4, 5, 4095, 4096, 4097])('handles packed arrays and tails of length %s', size => {
    const exponents = BigInt64Array.from({ length: size }, (_, i) => BigInt(10 ** 12 + i));
    const moduli = Int32Array.from({ length: size }, (_, i) => 1 + i % 997);
    const result = powerStoredInt32(2n, typedArray(exponents), typedArray(moduli));
    if (size === 0) { expect(result).toBeUndefined(); return; }
    expect(result).toBeDefined();
    expect([...result!.items]).toEqual(Array.from(exponents, (e, i) => modularPower(2n, e, BigInt(moduli[i]))));
});
it('declines invalid and out-of-domain stored inputs before publication', () => {
    for (const [exponents, moduli] of [
        [[1n, -1n, 3n, 4n], [2, 3, 5, 7]],
        [[1n, 2n, 3n, 4n], [2, 0, 5, 7]],
        [[1n, 9007199254740993n, 3n, 4n], [2, 3, 5, 7]],
    ] as [bigint[], number[]][]) {
        expect(powerStoredInt32(2n, typedArray(BigInt64Array.from(exponents)), typedArray(Int32Array.from(moduli)))).toBeUndefined();
    }
});
it('retains ordinary work and interruption paths', () => {
    const exponents = typedArray(BigInt64Array.of(1n, 2n, 3n, 4n)), moduli = typedArray(Int32Array.of(3, 5, 7, 11));
    expect(withDemandBudget(100000, () => powerStoredInt32(2n, exponents, moduli))).toBeUndefined();
    expect(withInterrupt(new Int32Array(1), () => powerStoredInt32(2n, exponents, moduli))).toBeUndefined();
});
it.each([2n, -3n, 9007199254740993n])('retains exact public results for base %s', async base => {
    const { Interpreter, isRankArray } = await import('../src/index.js');
    const exponents = [0n, 1n, 4294967295n, 4294967296n, 1000000000000n, 9007199254740993n];
    const moduli = [1, 2, 998244353, 1073741824, 1073741825, 97];
    const runtime = new Interpreter(() => {});
    try {
        runtime.variables.set('E', typedArray(BigInt64Array.from(exponents)));
        runtime.variables.set('M', typedArray(Int32Array.from(moduli)));
        runtime.variables.set('Base', base);
        const value = runtime.execute('use numbers\nBase E M powmod');
        if (!value || !isRankArray(value)) throw Error('expected result');
        expect([...value.items]).toEqual(exponents.map((e, i) => modularPower(base, e, BigInt(moduli[i]))));
    } finally { runtime.dispose(); }
});
it('keeps scalar expansion and distinct broadcast shapes', async () => {
    const { Interpreter, isRankArray } = await import('../src/index.js');
    const runtime = new Interpreter(() => {});
    try {
        runtime.variables.set('E', typedArray(BigInt64Array.of(1000000000000n, 4294967296n), [2, 1]));
        runtime.variables.set('M', typedArray(Int32Array.of(3, 5, 7), [1, 3]));
        const value = runtime.execute('use numbers\n2 E M powmod');
        if (!value || !isRankArray(value)) throw Error('expected result');
        expect(value.shape).toEqual([2, 3]);
        expect([...value.items]).toEqual([1000000000000n, 4294967296n].flatMap(e => [3n, 5n, 7n].map(m => modularPower(2n, e, m))));
    } finally { runtime.dispose(); }
});
it('handles reversed and strided native views', async () => {
    const { Interpreter, isRankArray } = await import('../src/index.js');
    const runtime = new Interpreter(() => {});
    const exponents = Array.from({ length: 10 }, (_, i) => 1000000000000n + BigInt(i));
    const moduli = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31];
    try {
        runtime.variables.set('E', typedArray(BigInt64Array.from(exponents)));
        runtime.variables.set('M', typedArray(Int32Array.from(moduli)));
        const value = runtime.execute('use numbers\nuse sequences\nEs = E (8 to 0 by -2)\nMs = M (1 to 9 by 2)\n2 Es Ms powmod');
        if (!value || !isRankArray(value)) throw Error('expected result');
        expect([...value.items]).toEqual([8, 6, 4, 2, 0].map((i, lane) => modularPower(2n, exponents[i], BigInt(moduli[lane * 2 + 1]))));
    } finally { runtime.dispose(); }
});
it('does not probe an opaque item reader', () => {
    const exponents = typedArray(BigInt64Array.of(1n, 2n, 3n, 4n));
    let reads = 0;
    Object.defineProperty(exponents, 'itemAt', { value: (index: number) => { reads++; return BigInt(index); } });
    expect(powerStoredInt32(2n, exponents, typedArray(Int32Array.of(3, 5, 7, 11)))).toBeUndefined();
    expect(reads).toBe(0);
});
it('retains empty public results and partial state on domain errors', async () => {
    const { Interpreter, isRankArray, RankError } = await import('../src/index.js');
    const runtime = new Interpreter(() => {});
    try {
        const empty = runtime.execute('use numbers\nE = array shape 0 fill 0\n2 E E powmod');
        if (!empty || !isRankArray(empty)) throw Error('expected empty result');
        expect(empty.shape).toEqual([0]); expect([...empty.items]).toEqual([]);
        runtime.variables.set('E', typedArray(BigInt64Array.of(1n, 2n, -1n, 4n)));
        runtime.variables.set('M', typedArray(Int32Array.of(3, 5, 7, 11)));
        expect(() => runtime.execute('Before = 7\nResult = 2 E M powmod')).toThrow(RankError);
        expect(runtime.variables.get('Before')).toBe(7n);
        expect(runtime.variables.get('Result')).toBeUndefined();
    } finally { runtime.dispose(); }
});
it.each([0, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER])('handles base boundaries %s', base => {
    const exponents = [0, 1, 4294967296, Number.MAX_SAFE_INTEGER], moduli = [1, 2, 1073741824, 999999937];
    const out = new Int32Array(4);
    modularModuliQuad(base, exponents[0], exponents[1], exponents[2], exponents[3], moduli[0], moduli[1], moduli[2], moduli[3], out, 0);
    expect([...out]).toEqual(exponents.map((e, i) => Number(modularPower(BigInt(base), BigInt(e), BigInt(moduli[i])))));
});

it('keeps preceding work when late moduli need the wide scalar multiplier', () => {
    const exponents = BigInt64Array.from({ length: 4101 }, (_, i) => 1000000000000n + BigInt(i));
    const moduli = Int32Array.from({ length: 4101 }, (_, i) => i >= 4094 ? 2147483647 - i % 3 : 1000000007);
    const value = powerStoredInt32(-3n, typedArray(exponents), typedArray(moduli));
    expect(value).toBeDefined();
    expect([...value!.items]).toEqual(Array.from(exponents, (e, i) => modularPower(-3n, e, BigInt(moduli[i]))));
});
