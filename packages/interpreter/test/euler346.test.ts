import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/346_strongrepunits.ra', import.meta.url), 'utf8');
const helpers = source.slice(0, source.indexOf('\nAnswer ='));

// Inspect each number's base digits, independently of the solver's family sum
// and discriminant test. A qualifying representation has at least three ones.
function strong(n: number): boolean {
    if (n === 1) return true;
    for (let base = 2; base * base + base + 1 <= n; base++) {
        let rest = n, digits = 0;
        while (rest > 0 && rest % base === 1) {
            rest = Math.floor(rest / base);
            digits++;
        }
        if (rest === 0 && digits >= 3) return true;
    }
    return false;
}
const sums = [0];
for (let n = 1; n < 10000; n++) sums[n] = sums[n - 1] + (strong(n) ? n : 0);

describe('Euler 346 strong repunits', () => {
    for (const compilation of [true, false]) {
        it(`matches base-digit enumeration (compilation=${compilation})`, () => {
            const output: string[] = [];
            const runtime = new Interpreter(text => output.push(text.trim()), { compilation });
            const limits = new Set([0, ...Array.from({ length: 512 }, (_, i) => i + 1)]);
            // Include strict boundaries at longer repunits and family collisions.
            for (const n of [7, 15, 31, 40, 8191, 9991]) {
                for (const delta of [-1, 0, 1]) limits.add(n + delta);
            }
            try {
                runtime.execute(helpers + '\n' + [...limits].map(n => `${n} strong print`).join('\n'));
                expect(output).toEqual([...limits].map(n => String(n <= 1 ? 0 : sums[n - 1])));
            } finally { runtime.dispose(); }
        });
        it(`computes the full target (compilation=${compilation})`, () => {
            const output: string[] = [];
            const runtime = new Interpreter(text => output.push(text.trim()), { compilation });
            try {
                runtime.execute(source);
                expect(output.at(-1)).toBe('336108797689259276');
            } finally { runtime.dispose(); }
        });
    }
});
