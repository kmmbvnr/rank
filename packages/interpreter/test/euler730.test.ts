import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/730_shiftedtriples.ra', import.meta.url), 'utf8');
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;

// Enumerate every leg pair and possible hypotenuse. This oracle uses neither
// the Berggren maps nor the program's bound on roots.
function brute(shifts: number, perimeter: number): bigint {
    let count = 0n;
    for (let first = 1; first * 3 <= perimeter; first++) {
        for (let second = first; first + 2 * second <= perimeter; second++) {
            const squares = first * first + second * second;
            for (let hyp = Math.ceil(Math.sqrt(squares)); hyp * hyp <= squares + shifts; hyp++) {
                if (first + second + hyp <= perimeter && gcd(gcd(first, second), hyp) === 1) count++;
            }
        }
    }
    return count;
}
function run(shifts: number, perimeter: number, budget: number, compilation: boolean): bigint {
    const runtime = new Interpreter(() => {}, { compilation });
    try {
        runtime.execute(source.replace('arg Shifts integer = 100', `Shifts = ${shifts}`)
            .replace('arg Perimeter integer = 10 ** 8', `Perimeter = ${perimeter}`)
            .replace(/arg Budget integer = \d+/, `Budget = ${budget}`));
        return answerOf(runtime) as bigint;
    } finally { runtime.dispose(); }
}
for (const compilation of [false, true]) describe(`Euler 730 (compiled=${compilation})`, () => {
    it.each([[0, 10], [0, 100], [1, 50], [2, 20], [3, 100], [5, 150], [10, 200]])(
        'matches exhaustive leg enumeration for shifts=%i, perimeter=%i', (shifts, perimeter) => {
            expect(run(shifts, perimeter, 4096, compilation)).toBe(brute(shifts, perimeter));
        });
    it.each([1, 7, 64, 4096])('keeps counts independent of pool block size %i', budget => {
        expect(run(3, 100, budget, compilation)).toBe(brute(3, 100));
    });
});
