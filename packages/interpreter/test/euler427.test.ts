import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { boundedRunAnswer } from '../../../benchmarks/experiments/euler427-oracle.mjs';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/427_nsequences.ra', import.meta.url), 'utf8');

describe('Euler 427 folded inclusion-exclusion', () => {
    it.each([0,1,2,3,4,5,6,7,8,9,10,11,12,15,16,17,24,31,32,47,60,64,97,100])('matches bounded-run DP at N=%s in all backends', n => {
        const expected = boundedRunAnswer(n);
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
            const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
            try {
                runtime.execute(source);
                expect(answerOf(runtime)).toBe(expected);
            } finally { runtime.dispose(); }
        }
    });

    it('retains the full golden answer with private numeric table and sum loops', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect(answerOf(runtime)).toBe(97138867n);
            expect(diagnostics.numberLoops).toBe(3);
            expect(diagnostics.numberLoopOverflows).toBe(0);
            expect(diagnostics.numberFunctionFallbacks).toBe(0);
            expect(diagnostics.fallbacks['number-loop:condition-write-budget']).toBeUndefined();
        } finally { runtime.dispose(); }
    }, 60000);
});
