import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { perBallReference } from '../../../benchmarks/experiments/euler426-oracle.mjs';
const source = readFileSync(new URL('../../../demos/euler/426_boxball.ra', import.meta.url), 'utf8');

describe('Euler 426 compressed closing rounds', () => {
    it.each([0,1,2,3,4,5,10,11,20,31,32,63,64,100,511,512,1000,10000])('matches the independent per-ball stack at last=%s in every backend', last => {
        const expected = BigInt(perBallReference(last));
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
            const runtime = new Interpreter(() => {}, { ...options, args: [`--last=${last}`] });
            try {
                runtime.execute(source);
                expect(runtime.variables.get('Answer')).toBe(expected);
            } finally { runtime.dispose(); }
        }
    }, 30000);

    it('compiles private doubling stacks without numeric replay', () => {
        const runtime = new Interpreter(() => {}, { args: ['--last=1000000'] });
        const diagnostics = new RuntimeDiagnostics();
        try {
            const tiny = source.replace('Capacity = Last + 10 min 1024', 'Capacity = 2');
            diagnostics.run(() => runtime.execute(tiny));
            expect(runtime.variables.get('Answer')).toBe(BigInt(perBallReference(1000000)));
            expect(diagnostics.numberLoops).toBe(1);
            expect(diagnostics.numberLoopOverflows).toBe(0);
            expect(diagnostics.numberFunctionFallbacks).toBe(0);
        } finally { runtime.dispose(); }
    }, 30000);
});
