import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/746_messydinner.ra', import.meta.url), 'utf8');
// Enumerate complete cyclic ternary words; use no transfer matrix or masks.
function direct(families: number): bigint {
    const factorial = [1n];
    for (let i = 1; i <= 2 * families; i++) factorial.push(factorial[i - 1] * BigInt(i));
    let answer = 0n;
    for (let n = 2; n <= families; n++) {
        const length = 2 * n, counts = Array<bigint>(n + 1).fill(0n);
        for (let encoded = 0; encoded < 3 ** length; encoded++) {
            let rest = encoded, weight = 0;
            const word: number[] = [];
            for (let i = 0; i < length; i++) { word.push(rest % 3); rest = Math.floor(rest / 3); }
            let valid = true;
            for (let i = 0; i < length; i++) {
                if (word[i]) weight++;
                if (word[i] && word[(i + 1) % length]
                    || word[i] === 2 && word[(i + 2) % length] === 1) { valid = false; break; }
            }
            if (valid) counts[weight]++;
        }
        for (let k = 0; k <= n; k++) answer += 2n * (k % 2 ? -1n : 1n) * counts[k]
            * factorial[n] / factorial[n - k] * 4n ** BigInt(k) * factorial[length - 2 * k] ** 2n;
    }
    return answer;
}
const cases = [1, 2, 3, 4, 5, 6].map(families => ({ families, expected: direct(families) }));
for (const compilation of [false, true]) describe(`Euler 746 (compiled=${compilation})`, () => {
    it.each(cases)('matches cyclic-word enumeration for Families=$families', ({ families, expected }) => {
        for (const prime of [101, 1000000007]) {
            const r = new Interpreter(() => {}, { compilation });
            try {
                r.execute(source.replace('arg Families integer = 2021', `Families = ${families}`)
                    .replace('arg Prime integer = 1000000007', `Prime = ${prime}`));
                expect(answerOf(r)).toBe(expected % BigInt(prime));
            } finally { r.dispose(); }
        }
    });
    it('keeps the existing Families=10 example', () => {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.execute(source.replace('arg Families integer = 2021', 'Families = 10'));
            expect(answerOf(r)).toBe(399291975n);
        } finally { r.dispose(); }
    });
});
