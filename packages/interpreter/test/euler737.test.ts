import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/737_coinloops.ra', import.meta.url), 'utf8');
// Direct harmonic recurrence; no chunks or asymptotic harmonic estimate.
function direct(loops: number): number {
    let harmonic = 0, angle = 0;
    for (let coin = 1; ; coin++) {
        harmonic += 1 / coin;
        const reach = angle + Math.atan(Math.sqrt(4 * coin / harmonic - 1));
        if (reach > 2 * Math.PI * loops) return coin + 1;
        angle += Math.atan(Math.sqrt(coin / harmonic - 0.25) / (coin + 0.5));
    }
}
for (const compilation of [false, true]) describe(`Euler 737 (compiled=${compilation})`, () => {
    it.each([0, 1, 2, 3, 10, 11, 20, 50])('matches direct recurrence through %i loops', loops => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source.replace('arg Loops integer = 2020', `Loops = ${loops}`)
                .replace('Prefix = 1000000', 'Prefix = 10000')
                .replace('Chunk = 1048576', 'Chunk = 8192')
                .replace('256 4096', '2 4096'));
            const expected = direct(loops);
            expect(Number(answerOf(runtime))).toBe(expected);
            if (loops === 1) expect(expected).toBe(31);
            if (loops === 2) expect(expected).toBe(154);
            if (loops === 10) expect(expected).toBe(6947);
        } finally { runtime.dispose(); }
    });
});
