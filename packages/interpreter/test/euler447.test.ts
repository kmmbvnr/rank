import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/447_retractions.ra', import.meta.url), 'utf8');
// Direct factorization supplies unitary divisors, without Mobius inversion
// or the demo's summatory-divisor hyperbola.
const totals = [0n];
for (let n = 1; n <= 1000; n++) {
    let rest = n, unitary = 1;
    for (let prime = 2; prime * prime <= rest; prime++) {
        let power = 1;
        while (rest % prime === 0) { rest /= prime; power *= prime; }
        if (power > 1) unitary *= power + 1;
    }
    if (rest > 1) unitary *= rest + 1;
    totals.push(totals.at(-1)! + BigInt(unitary - n));
}
it.each([0, 1, 2, 3, 4, 9, 10, 15, 16, 17, 63, 64, 65, 99, 100, 999, 1000])(
    'matches direct unitary divisors for Euler 447 at %s', limit => {
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
            for (const cut of [0, 1, 2, 10, 1000]) {
                const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${limit}`, `--cut=${cut}`] });
                try {
                    runtime.execute(source);
                    expect(answerOf(runtime)).toBe(totals[limit]);
                } finally { runtime.dispose(); }
            }
        }
    }, 30000);
it('preserves the full Euler 447 answer without Number overflow', () => {
    const runtime = new Interpreter(() => {});
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(answerOf(runtime)).toBe(530553372n);
        expect(diagnostics.numberLoops).toBeGreaterThan(0);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    } finally { runtime.dispose(); }
}, 60000);

it('repeats imported runs with changing N and Cut on all backends', () => {
    const fixture = new URL('../../../demos/euler/447_retractions_test.ra', import.meta.url);
    for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
        const results: { passed: boolean }[] = [];
        const runtime = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
            loadModule(specifier) {
                expect(specifier).toBe('447_retractions');
                return { id: new URL('447_retractions.ra', fixture).pathname, source };
            }, onTestResult: result => results.push(result) });
        try {
            runtime.execute(readFileSync(fixture, 'utf8'));
            expect(results.map(result => result.passed)).toEqual([true, true, true]);
        } finally { runtime.dispose(); }
    }
});
