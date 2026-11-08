import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
const fixture = new URL('../../../demos/euler/489_commonfactors_test.ra', import.meta.url);
const source = readFileSync(new URL('489_commonfactors.ra', fixture), 'utf8');
const backends: InterpreterOptions[] = [{}, { compilation: false }, { numberLoopCompilation: false }];
function gcd(a: number, b: number): number {
    while (b) [a, b] = [b, a % b];
    return a;
}
// Enumerate a complete resultant period, independently of prime powers,
// root lifting and CRT. Intermediate modular products stay below 2^53.
function brute(a: number, b: number): bigint {
    const cube = a ** 3, bound = cube * (cube * cube + 27 * b * b);
    const power = (x: number) => (x * x % bound) * x % bound;
    let maximum = 0, first = 0;
    for (let n = 0; n < bound; n++) {
        const value = gcd(gcd(power(n) + b, power(n + a) + b), bound);
        if (value > maximum) { maximum = value; first = n; }
    }
    return BigInt(first);
}
const small = Array.from({ length: 4 }, (_, i) => Array.from({ length: 6 }, (_, j) => {
    const a = i + 1, b = j + 1;
    return { a, b, expected: brute(a, b) };
})).flat();
it.each(backends)('matches all least maximizing roots for a<=4,b<=6 with %j', options => {
    const r = new Interpreter(() => {}, options);
    try {
        r.execute(source.replace('arg Ma integer = 18', 'arg Ma integer = 0').replace('arg Nb integer = 1900', 'arg Nb integer = 0'));
        for (const { a, b, expected } of small) expect(r.execute(`${a} common ${b}`)).toBe(expected);
        expect(small.reduce((sum, item) => sum + item.expected, 0n)).toBe(16632n);
    } finally { r.dispose(); }
});
const independentPairs = [
    [6, 216, 30n], [8, 1024, 408n], [11, 121, 363n], [7, 343, 35n],
    [12, 1728, 60n], [18, 1900, 3928442n], [18, 18, 11982n],
    [9, 729, 45n], [16, 512, 808n],
] as const;
it.each(backends)('matches the independent exact oracle at singular prime powers with %j', options => {
    const r = new Interpreter(() => {}, options);
    try {
        r.execute(source.replace('arg Ma integer = 18', 'arg Ma integer = 0').replace('arg Nb integer = 1900', 'arg Nb integer = 0'));
        for (const [a, b, expected] of independentPairs) expect(r.execute(`${a} common ${b}`)).toBe(expected);
    } finally { r.dispose(); }
});
it.each(backends)('retains the statement fixture and empty parameter grids with %j', options => {
    const results: boolean[] = [];
    const r = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
        loadModule: () => ({ id: new URL('489_commonfactors.ra', fixture).pathname, source }),
        onTestResult: result => results.push(result.passed) });
    try { r.execute(readFileSync(fixture, 'utf8')); expect(results).toEqual([true]); }
    finally { r.dispose(); }
    for (const [a, b] of [[0, 0], [0, 3], [3, 0], [-1, 3], [3, -1], [-1, -2]]) {
        const host = new Interpreter(() => {}, { ...options, args: [`--ma=${a}`, `--nb=${b}`] });
        try { host.execute(source); expect(host.variables.get('Answer')).toBe(0n); }
        finally { host.dispose(); }
    }
});
it('matches the full default exact oracle', () => {
    const r = new Interpreter();
    try { r.execute(source); expect(r.variables.get('Answer')).toBe(1791954757162n); }
    finally { r.dispose(); }
}, 120000);
