import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, type NativeFunction, type InterpreterOptions } from '../src/index.js';
import { ownedArray } from '../src/array-storage.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/554_centaurs.ra', import.meta.url), 'utf8');
const mod = (x: bigint, p: bigint) => (x % p + p) % p;
function choose(n: bigint, k: bigint): bigint {
    let result = 1n;
    for (let i = 1n; i <= k; i++) result = result * (n - k + i) / i;
    return result;
}
function lucas(n: bigint, k: bigint, p: bigint): bigint {
    let result = 1n;
    while (n || k) {
        const a = n % p, b = k % p;
        if (b > a) return 0n;
        result = result * choose(a, b) % p;
        n /= p; k /= p;
    }
    return result;
}
function oracle(top: number, p = 100000007n, digits = false) {
    let a = 1n, b = 2n, total = 0n;
    for (let i = 2; i <= top; i++) {
        const central = digits ? lucas(2n * a, a, p) : choose(2n * a, a) % p;
        total = mod(total + 8n * central - 3n * a * a - 2n * a - 7n, p);
        [a, b] = [b, a + b];
    }
    return total;
}
function solve(top: number, options: InterpreterOptions, p = 100000007) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--top=${top}`] });
    try { runtime.execute(source.replace('Prime = 100000007', `Prime = ${p}`)); return answerOf(runtime); }
    finally { runtime.dispose(); }
}
describe.each([{}, { compilation: false }, { numberLoopCompilation: false }])('Euler 554 %j', options => {
    it.each([0, 1, 2, 3, 4, 5, 6, 10, 12, 15])('matches exact BigInt central binomials through %s', top => {
        expect(solve(top, options)).toBe(oracle(top));
    });
    it.each([5, 90, 120, 200])('handles variable Lucas width through %s', top => {
        expect(solve(top, options, 101)).toBe(oracle(top, 101n, true));
    });
    it('matches the full answer', () => expect(solve(90, options)).toBe(89539872n));
    it('reflects unsorted factorial targets around the Wilson midpoint', () => {
        const runtime = new Interpreter(() => {}, { ...options, args: ['--top=1'] });
        try {
            runtime.execute(source.replace('Prime = 100000007', 'Prime = 101'));
            const points = [100, 0, 51, 1, 49, 99, 50, 2, 100];
            const fn = runtime.variables.get('factorials') as NativeFunction;
            const answer = fn.call([ownedArray(points.map(BigInt))]);
            const factorials = [1n];
            for (let i = 1; i <= 100; i++) factorials.push(factorials[i - 1] * BigInt(i) % 101n);
            if (!isRankArray(answer)) throw Error('expected factorial array');
            expect([...answer.items]).toEqual(points.map(n => factorials[n]));
        } finally { runtime.dispose(); }
    });
});
