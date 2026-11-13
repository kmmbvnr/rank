import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/451_modularinverses.ra', import.meta.url), 'utf8');
function roots(limit: number) {
    const result = Array<bigint>(limit + 1).fill(0n);
    for (let n = 3; n <= limit; n++) {
        for (let value = n - 2; value > 0; value--) if (value * value % n === 1) {
            result[n] = BigInt(value);
            break;
        }
    }
    return result;
}
it.each([0, 1, 2, 3, 4, 7, 8, 9, 15, 16, 24, 25, 26, 63, 64, 65, 100, 255, 256, 257, 1000])(
    'matches every modular root through %s on all backends', limit => {
        const expected = roots(limit);
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
            const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${limit}`] });
            try {
                runtime.execute(source);
                expect((runtime.variables.get('B') as RankArray).items).toEqual(expected);
                expect(answerOf(runtime)).toBe(expected.reduce((sum, value) => sum + value, 0n));
            } finally { runtime.dispose(); }
        }
    });
it('compiles the full search in one private region without replay', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(answerOf(runtime)).toBe(153651073760956n);
        expect((runtime.variables.get('B') as RankArray).shape).toEqual([20000001]);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
        expect(diagnostics.numberLoopCopyProbes).toBe(0);
    } finally { runtime.dispose(); }
}, 60000);
it('retains helper captures and B across repeated fixture runs', () => {
    const fixture = new URL('../../../demos/euler/451_modularinverses_test.ra', import.meta.url);
    for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
        const results: { passed: boolean }[] = [];
        const runtime = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
            loadModule(specifier) {
                expect(specifier).toBe('451_modularinverses');
                return { id: new URL('451_modularinverses.ra', fixture).pathname, source };
            }, onTestResult: result => results.push(result) });
        try {
            runtime.execute(readFileSync(fixture, 'utf8'));
            expect(results.map(result => result.passed)).toEqual([true, true, true]);
        } finally { runtime.dispose(); }
    }
}, 60000);
