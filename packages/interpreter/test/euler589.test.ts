import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { withoutReturn } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/589_poohsticks.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler589-original.ra', import.meta.url), 'utf8');
function run(text: string, k: number, d: number, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, args: [`--k=${k}`, `--d=${d}`] });
    try { runtime.execute(text); return runtime.variables.get('Answer'); }
    finally { runtime.dispose(); }
}
describe.each([true, false])('Euler 589 (compilation=%s)', compilation => {
    it.each([[0, 5], [1, 5], [2, 0], [2, 1], [3, 5], [5, 0], [5, 5], [8, 1], [8, 8], [12, 5]])
    ('matches the original two-phase system at K=%s D=%s', (k, d) => {
        expect(run(source, k, d, compilation)).toBe(run(original, k, d, true));
    });
    it('matches the statement expectation for m=60, n=30', () => {
        const runtime = new Interpreter(() => {}, { compilation, args: ['--k=1'] });
        try {
            runtime.execute(withoutReturn(source) + '\nSample = (60 expectation 30) round 2');
            expect(runtime.variables.get('Sample')).toBe(1036.15);
        } finally { runtime.dispose(); }
    });
});
