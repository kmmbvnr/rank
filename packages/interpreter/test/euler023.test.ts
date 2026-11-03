import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { withInterrupt, type InterruptSignal } from '../src/interrupt.js';

const source = readFileSync(new URL('../../../demos/euler/023_abundantsums.ra', import.meta.url), 'utf8');
function oracle(limit: number) {
    const abundant = Array.from({ length: limit + 1 }, (_, n) => {
        let sum = 0;
        for (let d = 1; d < n; d++) if (n % d === 0) sum += d;
        return sum > n;
    });
    let sum = 0;
    for (let n = 1; n <= limit; n++) {
        let pair = false;
        for (let a = 1; a <= n / 2; a++) if (abundant[a] && abundant[n - a]) { pair = true; break; }
        if (!pair) sum += n;
    }
    return BigInt(sum);
}
for (const compilation of [false, true]) describe(`Euler 23 (${compilation})`, () => {
    it('matches direct divisor/pair search for every limit 0 through 80', () => {
        for (let limit = 0; limit <= 80; limit++) {
            const r = new Interpreter(() => {}, { compilation, args: [`--limit=${limit}`] });
            try { r.execute(source); expect(r.variables.get('Answer')).toBe(oracle(limit)); }
            finally { r.dispose(); }
        }
    });
    it('keeps the full default answer under observable mobile polling', () => {
        const r = new Interpreter(() => {}, { compilation });
        const words = [0, 0, 0];
        const signal: InterruptSignal = { length: 3, load: i => words[i], store: (i, v) => { words[i] = v; },
            exchange(i, v) { const old = words[i]; words[i] = v; return old; }, wait() { throw Error('unexpected pause'); } };
        try { withInterrupt(signal, () => r.execute(source), () => {}); expect(r.variables.get('Answer')).toBe(4179871n); }
        finally { r.dispose(); }
    });
});
