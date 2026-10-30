import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';

const N = 6000;
const small = Int32Array.from({ length: N }, (_, i) => (i * 7919) % 200001 - 100000);
const other = Int32Array.from({ length: N }, (_, i) => (i * 104729) % 65537 - 30000);
const wide = BigInt64Array.from({ length: N }, (_, i) => BigInt(i) * 192233741999n * (i % 2 ? -1n : 1n) + (1n << 59n));
const counts = Int32Array.from({ length: N }, (_, i) => i % 70);
const smallCounts = Int32Array.from({ length: N }, (_, i) => i % 3);
const names = { S: small, O: other, W: wide, C: counts, K: smallCounts };

const reference: Record<string, (a: bigint, b: bigint) => bigint> = {
    band: (a, b) => a & b, bor: (a, b) => a | b, bxor: (a, b) => a ^ b,
    shl: (a, b) => a << b, shr: (a, b) => a >> b,
};

function run(source: string, cells: Record<string, Int32Array | BigInt64Array> = names): bigint[] {
    const runtime = new Interpreter();
    for (const [name, values] of Object.entries(cells)) runtime.variables.set(name, typedArray(values));
    try {
        const result = runtime.execute(`use bits\n${source}`);
        if (!result || !isRankArray(result)) throw Error('expected array');
        return Array.from({ length: N }, (_, i) => readArrayItem(result, i) as bigint);
    } finally { runtime.dispose(); }
}
const at = (cells: Int32Array | BigInt64Array) => (i: number) => BigInt(cells[i]);

describe('bitwise operations over stored integers', () => {
    for (const name of ['band', 'bor', 'bxor']) {
        it(`${name} over Int32 and Int64 cells matches exact arithmetic`, () => {
            for (const [left, right] of [['S', 'O'], ['W', 'S'], ['S', 'W'], ['W', 'W']] as const) {
                const l = at(names[left]), r = at(names[right]);
                expect(run(`${left} ${name} ${right}`))
                    .toEqual(Array.from({ length: N }, (_, i) => reference[name](l(i), r(i))));
            }
        });

        it(`${name} with a scalar matches exact arithmetic`, () => {
            const l = at(wide);
            expect(run(`W ${name} 1152921504606846975`))
                .toEqual(Array.from({ length: N }, (_, i) => reference[name](l(i), 1152921504606846975n)));
            expect(run(`-7 ${name} S`))
                .toEqual(Array.from({ length: N }, (_, i) => reference[name](-7n, at(small)(i))));
        });
    }

    it('shr matches exact arithmetic for every count up to beyond 64', () => {
        for (const left of ['S', 'W'] as const) {
            const l = at(names[left]);
            expect(run(`${left} shr C`)).toEqual(Array.from({ length: N }, (_, i) => l(i) >> BigInt(counts[i])));
        }
        expect(run('W shr 100')).toEqual(Array.from(wide, a => a >> 100n));
        expect(run('W shr 0')).toEqual(Array.from(wide, a => a));
    });

    it('shl matches exact arithmetic while the result fits Int64', () => {
        const l = at(small);
        expect(run('S shl K')).toEqual(Array.from({ length: N }, (_, i) => l(i) << BigInt(smallCounts[i])));
        expect(run('S shl 31')).toEqual(Array.from(small, a => BigInt(a) << 31n));
        expect(run('S shl 32')).toEqual(Array.from(small, a => BigInt(a) << 32n));
        expect(run('S shl 40')).toEqual(Array.from(small, a => BigInt(a) << 40n));
    });

    it('shl past Int64 stays exact', () => {
        expect(run('S shl 62')).toEqual(Array.from(small, a => BigInt(a) << 62n));
        expect(run('W shl 3')).toEqual(Array.from(wide, a => a << 3n));
    });

    it('rejects a negative shift count', () => {
        const negative = Int32Array.from({ length: N }, (_, i) => (i === 5 ? -1 : 1));
        expect(() => run('S shl P', { ...names, P: negative })).toThrow(/nonnegative/);
        expect(() => run('S shr P', { ...names, P: negative })).toThrow(/nonnegative/);
    });

    it('multiplies wide cells by a 0 and 1 mask exactly', () => {
        const mask = Int32Array.from({ length: N }, (_, i) => i % 3 === 0 ? 1 : 0);
        expect(run('W * M', { ...names, M: mask }))
            .toEqual(Array.from({ length: N }, (_, i) => BigInt(wide[i]) * BigInt(mask[i])));
        expect(run('M * W', { ...names, M: mask }))
            .toEqual(Array.from({ length: N }, (_, i) => BigInt(wide[i]) * BigInt(mask[i])));
        // A factor that is not 0 or 1 falls back to exact products.
        expect(run('W * 3')).toEqual(Array.from(wide, a => a * 3n));
    });

    it('any and all of a bitmap match the cells', () => {
        const runtime = new Interpreter();
        for (const [name, values] of Object.entries(names)) runtime.variables.set(name, typedArray(values));
        try {
            runtime.execute('use sequences');
            const high = Math.max(...small), low = Math.min(...small);
            expect(runtime.execute(`S greater ${high - 1} any`)).toBe(true);
            expect(runtime.execute(`S greater ${high} any`)).toBe(false);
            expect(runtime.execute(`S greater ${low - 1} all`)).toBe(true);
            expect(runtime.execute(`S greater ${low} all`)).toBe(false);
        } finally { runtime.dispose(); }
    });
});
