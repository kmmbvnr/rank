import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/739_summationofsummations.ra', import.meta.url), 'utf8');

// Literal repeated partial summation of the Lucas start; no ballot weights.
function direct(length: number, prime: bigint): bigint {
    let previous = 1n, current = 3n;
    let values = Array.from({ length }, (_, i) => {
        if (i === 0) return previous;
        const value = current;
        [previous, current] = [current, (previous + current) % prime];
        return value;
    });
    while (values.length > 1) {
        let sum = 0n;
        values = values.slice(1).map(value => sum = (sum + value) % prime);
    }
    return values[0];
}
for (const compilation of [false, true]) describe(`Euler 739 (compiled=${compilation})`, () => {
    it.each([1, 2, 3, 4, 8, 20, 31, 32, 33, 60])('matches repeated summation for Length=%i', length => {
        for (const chunk of [1, 7, 32]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(source.replace('arg Length integer = 10 ** 8', `Length = ${length}`)
                    .replace('arg Chunk integer = 4194304', `Chunk = ${chunk}`));
                const actual = answerOf(runtime), expected = direct(length, 1000000007n);
                expect(actual).toBe(expected);
                if (length === 8) expect(actual).toBe(2663n);
                if (length === 20) expect(actual).toBe(742296999n);
            } finally { runtime.dispose(); }
        }
    });
    it.each([8, 20, 60])('supports smaller valid prime for Length=%i', length => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source.replace('arg Length integer = 10 ** 8', `Length = ${length}`)
                .replace('arg Chunk integer = 4194304', 'Chunk = 7')
                .replace('arg Prime integer = 1000000007', 'Prime = 101'));
            expect(answerOf(runtime)).toBe(direct(length, 101n));
        } finally { runtime.dispose(); }
    });
});
