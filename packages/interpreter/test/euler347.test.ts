import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/347_twoprimes.ra', import.meta.url), 'utf8');
const helpers = source.slice(0, source.indexOf('\nAnswer ='));

// Factor every integer independently of the solver's prime-pair search.
const sums = [0, 0];
const maxima = new Map<string, number>();
for (let n = 2; n <= 1000; n++) {
    let rest = n;
    const factors: number[] = [];
    for (let p = 2; p * p <= rest; p++) {
        if (rest % p !== 0) continue;
        factors.push(p);
        while (rest % p === 0) rest /= p;
    }
    if (rest > 1) factors.push(rest);
    sums[n] = sums[n - 1];
    if (factors.length === 2) {
        const key = factors.join(',');
        sums[n] += n - (maxima.get(key) ?? 0);
        maxima.set(key, n);
    }
}

describe('Euler 347 two-prime maxima', () => {
    for (const compilation of [true, false]) {
        it(`matches integer factorization (compilation=${compilation})`, () => {
            const output: string[] = [];
            const runtime = new Interpreter(text => output.push(text.trim()), { compilation });
            try {
                runtime.execute(helpers + '\n' + sums.map((_, n) => `${n} twoprimes print`).join('\n'));
                expect(output).toEqual(sums.map(String));
            } finally { runtime.dispose(); }
        });
        it(`computes the full target (compilation=${compilation})`, () => {
            const output: string[] = [];
            const runtime = new Interpreter(text => output.push(text.trim()), { compilation });
            try {
                runtime.execute(source);
                expect(output.at(-1)).toBe('11109800204052');
            } finally { runtime.dispose(); }
        }, 45000);
    }
});
