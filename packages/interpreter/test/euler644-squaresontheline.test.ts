import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
// @ts-expect-error Independent sorted-event benchmark oracle.
import { solve } from '../../../benchmarks/euler644-oracle-sorted.mjs';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/644_squaresontheline.ra', import.meta.url), 'utf8');
for (const compilation of [false, true]) {
    it(`checks every gap maximum against sorted scalar events (${compilation})`, () => {
        for (const [lo, hi] of [[2, 2], [4, 4], [2, 3], [2, 10], [10, 20], [5, 25], [20, 40], [40, 70], [20, 100]]) {
            const expected = solve(lo, hi).answer;
            const runtime = new Interpreter(() => {}, { compilation, args: [`--lo=${lo}`, `--hi=${hi}`] });
            try {
                runtime.execute(source);
                if (lo === 2 && hi === 10) runtime.execute(source);
                expect(answerOf(runtime), `${lo}..${hi}`).toBe(expected);
            } finally { runtime.dispose(); }
        }
    }, 45_000);
}
