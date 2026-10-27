import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/170_pandigitalproducts.ra', import.meta.url), 'utf8');

// Enumerate INPUT digits (multiplier and factors), rather than output products.
// Check products as decimal strings; no gcd, encoded cut masks, or bit sets.
function oracle(digits: number[]): bigint {
    const target = [...digits].sort().join('');
    let answer = 0n;
    function check(multiplier: number, factors: number[]) {
        if (factors.length < 2) return;
        const products = factors.map(factor => String(multiplier * factor));
        if (products.join('').split('').sort().join('') !== target) return;
        products.sort((a, b) => (b + a).localeCompare(a + b));
        const candidate = BigInt(products.join(''));
        if (candidate > answer) answer = candidate;
    }
    function partition(text: string, multiplier: number, factors: number[]) {
        if (!text.length) { check(multiplier, factors); return; }
        if (text[0] === '0') return;
        for (let end = 1; end <= text.length; end++) {
            partition(text.slice(end), multiplier, [...factors, Number(text.slice(0, end))]);
        }
    }
    function permutations(prefix: string, rest: number[]) {
        if (!rest.length) {
            if (prefix[0] === '0') return;
            for (let width = 1; width <= prefix.length - 2; width++) {
                const multiplier = Number(prefix.slice(0, width));
                if (multiplier >= 2) partition(prefix.slice(width), multiplier, []);
            }
            return;
        }
        rest.forEach((digit, index) => permutations(prefix + digit, rest.filter((_, at) => at !== index)));
    }
    permutations('', digits);
    return answer;
}

const cases = [
    [9, 8, 7, 6], [9, 8, 7, 6, 5], [9, 8, 7, 6, 5, 4],
    [5, 4, 3, 2, 1, 0], [9, 8, 3, 2, 1, 0],
    [9, 8, 7, 4, 2, 1], [7, 5, 4, 3, 2, 1], [9, 7, 6, 5, 3, 1],
];
describe.each([false, true])('Euler 170 (compilation=%s)', compilation => {
    it.each(cases.map(digits => [digits.join(''), digits] as const))('matches an input-partition oracle for digits %s', (_, digits) => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source.replace('Digs = 9 to Low by -1 array', `Digs = array ${digits.join(' ')}`));
            expect(runtime.variables.get('Answer')).toBe(oracle(digits));
        } finally { runtime.dispose(); }
    });
});
