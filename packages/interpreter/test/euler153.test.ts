import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/153_gaussian.ra', import.meta.url), 'utf8');

// Direct divisibility of n / (a + bi), independent of Mobius inversion,
// divisor sums, and the lattice boundary walk used by the demo.
function oracle(limit: number): bigint {
    let total = 0n;
    for (let n = 1; n <= limit; n++) for (let a = 1; a <= n; a++) for (let b = 0; b <= n; b++) {
        const norm = a * a + b * b;
        if (n * a % norm === 0 && n * b % norm === 0) total += BigInt(a * (b === 0 ? 1 : 2));
    }
    return total;
}

describe.each([false, true])('Euler 153 (compilation=%s)', compilation => {
    it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100])(
        'agrees with direct Gaussian division for limit %i', limit => {
            const output: string[] = [];
            const r = new Interpreter(line => output.push(line), { compilation, args: [`--limit=${limit}`] });
            try {
                r.execute(source);
                const expected = oracle(limit);
                expect(r.variables.get('Answer')).toBe(expected);
                expect(output).toEqual([String(expected)]);
            } finally { r.dispose(); }
        });
});
