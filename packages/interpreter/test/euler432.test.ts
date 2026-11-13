import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { totientPrefix } from '../../../benchmarks/experiments/euler432-oracle.mjs';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/432_totientsum.ra', import.meta.url), 'utf8');
const expected = totientPrefix(10000);

describe('Euler 432 totient prefix and quotient tables', () => {
    it.each([0, 1, 2, 3, 4, 8, 9, 16, 25, 31, 32, 49, 64, 81, 100, 121, 300, 997, 1000, 4096, 10000])(
        'matches direct phi(510510*i) factorization at N=%s', n => {
            for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) for (const limit of [0, 1000]) {
                const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`, `--l=${limit}`] });
                try { runtime.execute(source); expect(answerOf(runtime)).toBe(expected[n]); }
                finally { runtime.dispose(); }
            }
        });

    it('preserves the full golden answer in private sieve and quotient regions', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect(answerOf(runtime)).toBe(754862080n);
            expect(diagnostics.numberLoops).toBe(2);
            expect(diagnostics.numberLoopOverflows).toBe(0);
            expect(diagnostics.numberLoopSliceCopies).toBe(0);
            expect(diagnostics.numberLoopSliceDirectCells).toBeGreaterThan(20000000);
        } finally { runtime.dispose(); }
    }, 60000);
});
