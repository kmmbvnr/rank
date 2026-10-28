import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/179_consecutivedivisors.ra', import.meta.url), 'utf8');
function divisors(n: number): number {
    let count = 0;
    for (let d = 1; d <= n; d++) if (n % d === 0) count++;
    return count;
}
function oracle(limit: number): bigint {
    let answer = 0n;
    for (let n = 2; n < limit; n++) if (divisors(n) === divisors(n + 1)) answer++;
    return answer;
}

describe.each([false, true])('Euler 179 (compilation=%s)', compilation => {
    it.each([1, 2, 3, 4, 5, 10, 14, 15, 16, 99, 100, 101, 256, 999, 1000])('matches trial division at limit %s', limit => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source.replace('arg Limit integer = 10000000', `arg Limit integer = ${limit}`));
            expect(runtime.variables.get('Answer')).toBe(oracle(limit));
        } finally { runtime.dispose(); }
    });
});
