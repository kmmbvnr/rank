import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { relativePrefix } from '../../../benchmarks/experiments/euler425-oracle.mjs';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/425_primeconnection.ra', import.meta.url), 'utf8');
const expected = relativePrefix(10000);

describe('Euler 425 prime connectivity thresholds', () => {
    it.each([0,1,2,10,11,13,101,109,200,1000,10000])('matches minimax paths at limit %s in every backend', n => {
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
            const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
            try {
                runtime.execute(source);
                expect(answerOf(runtime)).toBe(expected[n]);
            } finally { runtime.dispose(); }
        }
    });

    it('checks the full ten-million limit with compiled roots and packed rope completion', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect(answerOf(runtime)).toBe(46479497324n);
            expect(diagnostics.numberLoops).toBeGreaterThan(0);
            expect(diagnostics.numberFunctions).toBeGreaterThan(0);
            expect(diagnostics.numberLoopOverflows).toBe(0);
            expect(diagnostics.numberFunctionFallbacks).toBe(0);
            expect(diagnostics.nativeSequenceCopies).toBeGreaterThanOrEqual(2);
        } finally { runtime.dispose(); }
    }, 60000);
});
