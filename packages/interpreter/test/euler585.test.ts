import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/585_nestedsquareroots.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler585-original.ra', import.meta.url), 'utf8');

function run(n: number, options: InterpreterOptions = {}, text = source) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    try {
        runtime.execute(text);
        return ['Answer', 'C1', 'C2', 'C3'].map(name => runtime.variables.get(name));
    } finally { runtime.dispose(); }
}

describe.each([true, false])('Euler 585 (compilation=%s)', compilation => {
    it.each([0, 1, 2, 3, 4, 5, 8, 9, 10, 15, 20, 30, 100, 5000])('matches each original count at N=%s', n => {
        const options = { compilation };
        expect(run(n, options)).toEqual(run(n, options, original));
    });
    it('keeps duplicate norms and ordered pair weights at N=50000', () => {
        expect(run(50000, { compilation })).toEqual([1333490943n, 624864969n, 1418376606n, 1124658n]);
    });
    it('keeps the four full-scale counts', () => {
        expect(run(5000000, { compilation })).toEqual([17714439395932n, 6249980999760n, 22929380558578n, 463766234n]);
    }, 30000);
});
