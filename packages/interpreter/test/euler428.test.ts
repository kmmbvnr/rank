import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { necklacePrefix } from '../../../benchmarks/experiments/euler428-oracle.mjs';
const source = readFileSync(new URL('../../../demos/euler/428_necklacetriplets.ra', import.meta.url), 'utf8');
const expected = necklacePrefix(3000);

describe('Euler 428 necklace triplets', () => {
    it.each([0, 1, 2, 3, 4, 8, 9, 15, 16, 24, 25, 35, 36, 48, 49, 63, 64, 99, 100, 120, 121, 300, 1000, 3000])(
        'matches independent circle-equation factor pairs at N=%s', n => {
            for (const options of [{}, { numberLoopCompilation: false, arrayFunctionCompilation: false }, { compilation: false }]) {
                const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
                try {
                    runtime.execute(source);
                    expect(runtime.variables.get('Answer')).toBe(expected[n]);
                } finally { runtime.dispose(); }
            }
        });

    it('preserves the full golden answer and fuses quotient-table statistics', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect(runtime.variables.get('Answer')).toBe(747215561862n);
            expect(diagnostics.compiledArrayFunctions).toBeGreaterThanOrEqual(31622);
            expect(diagnostics.numberLoopOverflows).toBe(0);
        } finally { runtime.dispose(); }
    }, 60000);
});
