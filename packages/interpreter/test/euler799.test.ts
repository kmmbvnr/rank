import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { withoutReturn, answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/799_pentagonalpuzzle.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler799-original.ra', import.meta.url), 'utf8');
const helpers = 'use numbers\nuse sequences\n' + withoutReturn(source.slice(source.indexOf('fun Num pair_count')));
const pentagonal = (n: number) => n * (3 * n - 1) / 2;

// Enumerate pentagonal pairs independently of Gaussian factorization.
const counts = new Map<number, number>();
for (let a = 1; a < 500; a++) for (let b = a; b < 500; b++) {
    const sum = pentagonal(a) + pentagonal(b);
    counts.set(sum, (counts.get(sum) ?? 0) + 1);
}

describe.each([false, true])('Euler 799 compiled=%s', compilation => {
    it('matches every direct pair count through n=500', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(helpers);
            for (let n = 1; n <= 500; n++) {
                expect(runtime.execute(`${n} pair_count`), `n=${n}`).toBe(BigInt(counts.get(pentagonal(n)) ?? 0));
            }
        } finally { runtime.dispose(); }
    });
    it('sieves exactly the same factors and divisor counts', () => {
        const results = [original, source].map(program => {
            const runtime = new Interpreter(() => {}, { compilation, args: ['--limit=1000'] });
            try {
                runtime.execute(program.split('Rich =')[0]);
                return ['Rest', 'Divs'].map(name => formatValue(runtime.variables.get(name)!));
            } finally { runtime.dispose(); }
        });
        expect(results[1]).toEqual(results[0]);
    });
    it.each([[60, 1, 3577n], [300, 2, 107602n]])('retains the original answer at Limit=%s Least=%s', (limit, least, answer) => {
        for (const program of [original, source]) {
            const runtime = new Interpreter(() => {}, { compilation, args: [`--limit=${limit}`, `--least=${least}`, '--floor=1'] });
            try {
                runtime.execute(program);
                expect(answerOf(runtime)).toBe(answer);
            } finally { runtime.dispose(); }
        }
    });
});
