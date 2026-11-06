import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { unitarySquares } from '../../../benchmarks/experiments/euler429-oracle.mjs';
const source = readFileSync(new URL('../../../demos/euler/429_unitary.ra', import.meta.url), 'utf8');

describe('Euler 429 native array modular arithmetic', () => {
    it.each(Array.from({ length: 33 }, (_, n) => n))('enumerates unitary divisors of the exact factorial at N=%s', n => {
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
            const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
            try { runtime.execute(source); expect(runtime.variables.get('Answer')).toBe(unitarySquares(n)); }
            finally { runtime.dispose(); }
        }
    });
    it.each([true, false])('retains the full golden input (compilation=%s)', compilation => {
        const runtime = new Interpreter(() => {}, { compilation }), diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect(runtime.variables.get('Answer')).toBe(98792821n);
            expect(diagnostics.numberLoopOverflows).toBe(0);
        } finally { runtime.dispose(); }
    }, 60000);
});
