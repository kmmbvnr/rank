import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';

const N = 10000;
const floorMod = (a: bigint, b: bigint) => ((a % b) + b) % b;
const reference: Record<string, (a: bigint, b: bigint) => bigint> = {
    '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b,
    mod: floorMod, '//': (a, b) => (a - floorMod(a, b)) / b,
    min: (a, b) => a < b ? a : b, max: (a, b) => a > b ? a : b,
};
const small = Int32Array.from({ length: N }, (_, i) => (i * 7919) % 200001 - 100000);
const divisors = Int32Array.from({ length: N }, (_, i) => (i % 2 ? 1 : -1) * ((i * 31) % 9973 + 1));
const wide = BigInt64Array.from({ length: N }, (_, i) => BigInt(i) * 123456789012n - 4000000000000n);

function run(source: string, names: Record<string, Int32Array | BigInt64Array>) {
    const runtime = new Interpreter();
    for (const [name, cells] of Object.entries(names)) runtime.variables.set(name, typedArray(cells));
    try {
        const result = runtime.execute(source);
        if (!result || !isRankArray(result)) throw Error('expected array');
        return Array.from({ length: N }, (_, i) => readArrayItem(result, i) as bigint);
    } finally { runtime.dispose(); }
}

describe('stored integer arithmetic beyond Int32', () => {
    for (const [name, operation] of Object.entries(reference)) {
        it(`${name} over Int32 and Int64 cells matches exact arithmetic`, () => {
            const right = name === 'mod' || name === '//' ? divisors : small;
            for (const [left, cells] of [['S', small], ['W', wide]] as const) {
                if (name === '*' && left === 'W') continue;
                const got = run(`${left} ${name} R`, { S: small, W: wide, R: right });
                expect(got).toEqual(Array.from({ length: N }, (_, i) => operation(BigInt(cells[i]), BigInt(right[i]))));
            }
        });
    }

    it('keeps products beyond 2^53 exact', () => {
        const big = Int32Array.from({ length: N }, (_, i) => 2147483000 - i);
        const got = run('B * B', { B: big });
        expect(got).toEqual(Array.from(big, a => BigInt(a) * BigInt(a)));
    });

    it('reports a zero divisor', () => {
        const zeros = Int32Array.from({ length: N }, (_, i) => i % 3);
        expect(() => run('S mod Z', { S: small, Z: zeros })).toThrow(/zero/i);
        expect(() => run('S // Z', { S: small, Z: zeros })).toThrow(/zero/i);
    });
});
