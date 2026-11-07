import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/448_averagelcm.ra', import.meta.url), 'utf8');
function gcd(a: number, b: number): number {
    while (b) [a, b] = [b, a % b];
    return a;
}
// Average lcm(n,k) = sum(k/gcd(n,k)), independently of totient prefixes.
const totals = [0n];
for (let n = 1; n <= 1000; n++) {
    let average = 0;
    for (let k = 1; k <= n; k++) average += k / gcd(n, k);
    totals.push((totals.at(-1)! + BigInt(average)) % 999999017n);
}
it.each([0, 1, 2, 3, 4, 9, 10, 31, 32, 63, 64, 65, 99, 100, 499, 500, 1000])(
    'matches direct LCM averages for Euler 448 at %s', limit => {
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
            for (const length of [0, 1, 5, 17, 50, 1000]) {
                const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${limit}`, `--l=${length}`] });
                try {
                    runtime.execute(source);
                    expect(runtime.variables.get('Answer')).toBe(totals[limit]);
                } finally { runtime.dispose(); }
            }
        }
    }, 30000);
it('preserves the full Euler 448 answer without Number overflow', () => {
    const runtime = new Interpreter(() => {});
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(runtime.variables.get('Answer')).toBe(106467648n);
        expect(diagnostics.numberLoops).toBeGreaterThanOrEqual(2);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    } finally { runtime.dispose(); }
}, 60000);
it('repeats imported runs with changing N and L on all backends', () => {
    const fixture = new URL('../../../demos/euler/448_averagelcm_test.ra', import.meta.url);
    for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
        const results: { passed: boolean }[] = [];
        const runtime = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
            loadModule(specifier) {
                expect(specifier).toBe('448_averagelcm');
                return { id: new URL('448_averagelcm.ra', fixture).pathname, source };
            }, onTestResult: result => results.push(result) });
        try {
            runtime.execute(readFileSync(fixture, 'utf8'));
            expect(results.map(result => result.passed)).toEqual([true, true, true]);
        } finally { runtime.dispose(); }
    }
});
