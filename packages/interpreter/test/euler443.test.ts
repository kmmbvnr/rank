import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { withDemandBudget } from '../src/interrupt.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/443_gcdsequence.ra', import.meta.url), 'utf8');
const values = new Int32Array(20001);
values[4] = 13;
const gcd = (a: number, b: number) => { while (b) [a, b] = [b, a % b]; return a; };
for (let n = 5; n < values.length; n++) values[n] = values[n - 1] + gcd(n, values[n - 1]);
const samples = new Set(Array.from({ length: 29 }, (_, i) => i + 4));
for (let n = 33; n <= 1000; n++) if (values[n] === 3 * n) for (const offset of [-1, 0, 1]) samples.add(n + offset);
for (const n of [1999, 2000, 2001, 4999, 5000, 5001, 12345, 19999, 20000]) samples.add(n);
for (const n of [...samples].sort((a, b) => a - b)) {
    it(`matches the direct GCD recurrence at N=${n}`, () => {
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
            const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
            try { runtime.execute(source); expect(answerOf(runtime)).toBe(BigInt(values[n])); }
            finally { runtime.dispose(); }
        }
    });
}
it('consumes just the first factor instead of factoring an unused wide cofactor', () => {
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('Value', 3n * ((1n << 521n) - 1n));
            expect(withDemandBudget(64, () => runtime.execute('use numbers\nuse sequences\nValue factors first'))).toBe(3n);
        } finally { runtime.dispose(); }
    }
});
