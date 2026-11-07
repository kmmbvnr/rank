import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/749_nearpowersums.ra', import.meta.url), 'utf8');
// Enumerate numbers directly, independently of digit-count vectors/signatures.
function direct(length: number): bigint {
    const powers = Array.from({ length: 53 }, (_, k) => Array.from({ length: 10 }, (_, d) => BigInt(d) ** BigInt(k + 1)));
    let answer = 0n;
    for (let n = 1; n < 10 ** length; n++) {
        const digits = String(n).split('').map(Number), value = BigInt(n);
        if (powers.some(row => {
            const sum = digits.reduce((total, digit) => total + row[digit], 0n);
            return sum === value - 1n || sum === value + 1n;
        })) answer += value;
    }
    return answer;
}
const examples = [0, 1, 2, 3, 4].map(length => ({ length, expected: direct(length) }));
for (const compilation of [false, true]) describe(`Euler 749, compilation=${compilation}`, () => {
    it.each(examples)('matches direct enumeration at Length=$length', ({ length, expected }) => {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.execute(source.replace('arg Length integer = 16', `Length = ${length}`));
            expect(r.variables.get('Answer')).toBe(expected);
        } finally { r.dispose(); }
    });
    it('retains the six-digit statement example', () => {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.execute(source.replace('arg Length integer = 16', 'Length = 6'));
            expect(r.variables.get('Answer')).toBe(2562701n);
        } finally { r.dispose(); }
    });
});
