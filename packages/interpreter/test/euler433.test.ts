import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {Interpreter, RuntimeDiagnostics} from '../src/index.js';
import {euclidTotal} from '../../../benchmarks/experiments/euler433-oracle.mjs';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/433_euclidsteps.ra', import.meta.url), 'utf8');
const modes = [{}, {numberLoopCompilation: false}, {compilation: false}];

describe('Euler 433 Euclid chains', () => {
    it.each([0, 1, 2, 3, 4, 5, 6, 9, 10, 24, 25, 26, 49, 50, 99, 100, 121, 200, 300, 499, 1000])(
        'matches a direct square of Euclid divisions at N=%s', n => {
            const expected = euclidTotal(n);
            for (const options of modes) {
                const runtime = new Interpreter(() => {}, {...options, args: [`--n=${n}`]});
                try { runtime.execute(source); expect(answerOf(runtime)).toBe(expected); }
                finally { runtime.dispose(); }
            }
        });

    it('preserves the full default answer without Number replay', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect(answerOf(runtime)).toBe(326624372659664n);
            expect(diagnostics.numberLoops).toBeGreaterThanOrEqual(2);
            expect(diagnostics.numberFunctionFallbacks).toBe(0);
            expect(diagnostics.numberLoopOverflows).toBe(0);
        } finally { runtime.dispose(); }
    }, 60000);
});
