import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions, type RankArray } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
import { fullScale } from './full-scale.js';
const source = readFileSync(new URL('../../../demos/euler/557_cuttingtriangles.ra', import.meta.url), 'utf8');

// Enumerate piece areas, without reciprocal keys, sorting or group ranks.
function oracle(n: number) {
    let answer = 0n;
    for (let a = 1; a <= n - 3; a++) for (let b = 1; b < a; b++) for (let c = b; c <= n - a - b - 1; c++) {
        const den = a * a - b * c, num = a * (a + b) * (a + c);
        if (den <= 0 || num % den) continue;
        const total = num / den;
        if (total <= n && total > a + b + c) answer += BigInt(total);
    }
    return answer;
}
function solve(n: number, options: InterpreterOptions, text = source) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    try { runtime.execute(text); return runtime.variables.get('Answer'); }
    finally { runtime.dispose(); }
}
describe.each([{}, { compilation: false }, { numberLoopCompilation: false }])('Euler 557 %j', options => {
    it.each([0, 1, 2, 3, 4, 5, 6, 7, 10, 20, 31, 32, 33, 54, 55, 63, 64, 65])('matches piece-area enumeration through %s', n => {
        expect(solve(n, options)).toBe(oracle(n));
    });
    it.each([[20, 1, 7], [55, 3, 17], [54, 7, 11]])('keeps block/window boundaries at %s, %s, %s', (n, block, window) => {
        const text = source.replace(/Block = \d+/, `Block = ${block}`).replace('Window = 1000000', `Window = ${window}`);
        expect(solve(n, options, text)).toBe(oracle(n));
    });
    fullScale('matches the independent full discriminant search', () => {
        expect(solve(10000, options)).toBe(2699929328n);
    }, 30000);
});
it('crosses the default million-pair comparison window', () => {
    expect(solve(1414, {})).toBe(21244410n);
});

it.each([16384, 20000, 32769])('packs boundary rows exactly at N=%s without a full search', n => {
    const prefix = source.split("Packed =")[0];
    const runtime = new Interpreter(() => {}, { args: [`--n=${n}`] });
    try {
        runtime.execute(prefix);
        const fn = runtime.variables.get('pairs') as import('../src/index.js').NativeFunction;
        const value = fn.call([BigInt(n - 2)]);
        if (typeof value !== 'object' || value.kind !== 'array') throw Error('expected packed rows');
        const base = 1n << BigInt(BigInt(n).toString(2).length), radix = 2n * base, expected: bigint[] = [];
        const gcd = (a: bigint, b: bigint): bigint => b ? gcd(b, a % b) : a;
        for (let x = BigInt(n - 2); x <= n; x++) for (let y = x; y <= n; y++) {
            const sum = x + y, product = x * y, common = gcd(sum, product);
            expected.push((product / common * radix + sum / common) * base + x);
        }
        expect([...value.items]).toEqual(expected);
    } finally { runtime.dispose(); }
});

const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);

// Group exact fractions directly, without packed-key sorting or adjacency scans.
function fractionOracle(n: number): { answer: bigint; matched: bigint[] } {
    const base = 1n << BigInt(BigInt(n).toString(2).length), radix = 2n * base;
    const groups = new Map<string, { y: number; code: bigint }[]>();
    for (let x = 1; x <= n; x++) for (let y = x; y <= n; y++) {
        const g = gcd(x + y, x * y), numerator = (x + y) / g, denominator = x * y / g;
        const key = `${numerator}/${denominator}`;
        const group = groups.get(key) ?? [];
        group.push({ y, code: (BigInt(denominator) * radix + BigInt(numerator)) * base + BigInt(x) });
        groups.set(key, group);
    }
    let answer = 0n;
    const matched: bigint[] = [];
    for (const group of groups.values()) {
        for (let i = 0; i < group.length; i++) answer += BigInt(group[i].y * (group.length - 1 - i));
        if (group.length > 1) matched.push(...group.map(pair => pair.code));
    }
    matched.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    return { answer, matched };
}

describe('Euler 557 windowed adjacent-key search', () => {
    for (const window of [7, 31, 1000000]) for (const [n, answer] of [[20, 259n], [54, 3331n], [55, 3441n]] as const) {
        it(`preserves all matching pairs for N=${n}, window=${window}`, () => {
            const runtime = new Interpreter(() => {});
            try {
                runtime.execute(source.replace('N integer = 10000', `N integer = ${n}`)
                    .replace('Window = 1000000', `Window = ${window}`));
                const expected = fractionOracle(n);
                expect(expected.answer).toBe(answer);
                expect(runtime.variables.get('Answer')).toBe(answer);
                const matched = runtime.variables.get('Values') as RankArray;
                expect(Array.from({ length: matched.shape[0] }, (_, i) => readArrayItem(matched, i))).toEqual(expected.matched);
            } finally { runtime.dispose(); }
        });
    }
    it('agrees with direct fraction grouping with compilation disabled', () => {
        const runtime = new Interpreter(() => {}, { compilation: false });
        try {
            runtime.execute(source.replace('N integer = 10000', 'N integer = 55').replace('Window = 1000000', 'Window = 11'));
            expect(runtime.variables.get('Answer')).toBe(fractionOracle(55).answer);
        } finally { runtime.dispose(); }
    });
});
