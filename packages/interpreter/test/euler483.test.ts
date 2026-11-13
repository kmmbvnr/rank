import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
import { answerOf } from './support.js';
const fixture = new URL('../../../demos/euler/483_repeatedpermutation_test.ra', import.meta.url);
const source = readFileSync(new URL('483_repeatedpermutation.ra', fixture), 'utf8');
const backends: InterpreterOptions[] = [{}, { compilation: false }, { numberLoopCompilation: false }];
function factorial(n: number): bigint {
    let value = 1n;
    for (let i = 2; i <= n; i++) value *= BigInt(i);
    return value;
}
function gcd(a: bigint, b: bigint): bigint { while (b) [a, b] = [b, a % b]; return a; }
// Enumerate integer partitions of n, including fixed points. There is no
// largest-prime elimination, packed key, grouped sum or ragged expansion.
function cycleTypes(n: number): bigint {
    const scale = factorial(n);
    function visit(left: number, minimum: number, order: bigint, denominator: bigint): bigint {
        if (!left) return scale / denominator * order * order;
        let total = 0n;
        for (let length = minimum; length <= left; length++) {
            const cycle = BigInt(length), next = order / gcd(order, cycle) * cycle;
            let product = denominator;
            for (let count = 1; count * length <= left; count++) {
                product *= cycle * BigInt(count);
                total += visit(left - count * length, length + 1, next, product);
            }
        }
        return total;
    }
    return visit(n, 1, 1n, 1n);
}
function scientific(numerator: bigint, denominator: bigint): string {
    let exponent = (numerator / denominator).toString().length - 1;
    const shift = 9 - exponent;
    if (shift >= 0) numerator *= 10n ** BigInt(shift);
    else denominator *= 10n ** BigInt(-shift);
    let rounded = (2n * numerator + denominator) / (2n * denominator);
    if (rounded >= 10000000000n) { rounded /= 10n; exponent++; }
    const digits = rounded.toString().padStart(10, '0');
    return `${digits[0]}.${digits.slice(1)}e${exponent}`;
}
it.each([0, 1, 2, 3, 4, 5, 7, 10, 12, 20, 25, 30])('matches all cycle types at n=%s', n => {
    const expected = cycleTypes(n), answer = scientific(expected, factorial(n));
    for (const options of backends) {
        const r = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
        try { r.execute(source); expect(r.variables.get('Total')).toBe(expected); expect(answerOf(r)).toBe(answer); }
        finally { r.dispose(); }
    }
});
it.each(backends)('retains all statement fixtures with options=%j', options => {
    const results: boolean[] = [];
    const r = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
        loadModule(specifier) { expect(specifier).toBe('483_repeatedpermutation'); return { id: new URL('483_repeatedpermutation.ra', fixture).pathname, source }; },
        onTestResult: result => results.push(result.passed) });
    try { r.execute(readFileSync(fixture, 'utf8')); expect(results).toEqual([true]); } finally { r.dispose(); }
});
it('keeps the full default mean exactly rounded', () => {
    const r = new Interpreter(() => {});
    try { r.execute(source); expect(answerOf(r)).toBe('4.993401567e22'); }
    finally { r.dispose(); }
}, 60000);
