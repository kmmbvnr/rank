import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';

const N = 3000;
const edge = [0, 1, -1, 7, -7, 2147483647, -2147483648, 46341, -46341, 65536];
const make = (seed: number) => Int32Array.from({ length: N }, (_, i) => i < edge.length
    ? edge[(i + seed) % edge.length] : ((i * 2654435761 + seed * 40503) | 0) % (seed % 2 ? 100000 : 2147483647));
const X = make(1), Y = make(2), Z = Int32Array.from(make(3), v => v || 5);

function run(source: string, cells: Record<string, Int32Array>): (bigint | boolean)[] {
    const runtime = new Interpreter();
    for (const [name, values] of Object.entries(cells)) runtime.variables.set(name, typedArray(values));
    try {
        const result = runtime.execute(`use numbers\n${source}`);
        if (!result || !isRankArray(result)) throw Error('expected array');
        return Array.from({ length: N }, (_, i) => readArrayItem(result, i) as bigint | boolean);
    } finally { runtime.dispose(); }
}
const floorDiv = (a: bigint, b: bigint) => (a - ((a % b) + b) % b) / b;
const floorMod = (a: bigint, b: bigint) => ((a % b) + b) % b;
const ops: Record<string, (a: bigint, b: bigint) => bigint> = {
    '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b,
    mod: floorMod, '//': floorDiv, min: (a, b) => a < b ? a : b, max: (a, b) => a > b ? a : b,
};
const tests: Record<string, (a: bigint, b: bigint) => boolean> = {
    equal: (a, b) => a === b, 'not equal': (a, b) => a !== b, less: (a, b) => a < b,
    greater: (a, b) => a > b, 'at most': (a, b) => a <= b, 'at least': (a, b) => a >= b,
};

describe('compact integer kernels', () => {
    for (const [name, op] of Object.entries(ops)) {
        const infix = ` ${name} `;
        it(`${name} over Int32 cells and scalars matches exact arithmetic`, () => {
            const right = name === 'mod' || name === '//' ? Z : Y;
            expect(run(`X${infix}R`, { X, R: right })).toEqual(Array.from(X, (x, i) => op(BigInt(x), BigInt(right[i]))));
            expect(run(`X${infix}3`, { X })).toEqual(Array.from(X, x => op(BigInt(x), 3n)));
            expect(run(`-5${infix}R`, { R: right })).toEqual(Array.from(right, r => op(-5n, BigInt(r))));
        });
    }

    for (const [name, test] of Object.entries(tests)) {
        it(`${name} over Int32 cells and scalars matches exact comparison`, () => {
            expect(run(`X ${name} Y`, { X, Y })).toEqual(Array.from(X, (x, i) => test(BigInt(x), BigInt(Y[i]))));
            expect(run(`X ${name} 7`, { X })).toEqual(Array.from(X, x => test(BigInt(x), 7n)));
            expect(run(`7 ${name} X`, { X })).toEqual(Array.from(X, x => test(7n, BigInt(x))));
        });
    }

    it('keeps division by a zero cell an error', () => {
        const zeros = Int32Array.from(X, (_, i) => i === 2500 ? 0 : 1);
        expect(() => run('X mod Z', { X, Z: zeros })).toThrow();
        expect(() => run('X // Z', { X, Z: zeros })).toThrow();
    });
});
