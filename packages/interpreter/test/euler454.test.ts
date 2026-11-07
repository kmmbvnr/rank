import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/454_diophantinereciprocals.ra', import.meta.url), 'utf8');
const backends = [{}, { numberLoopCompilation: false }, { compilation: false }];
// Independent equation check: n = xy/(x+y) must be a positive integer.
function reference(limit: number) {
    let count = 0n;
    for (let x = 1; x < limit; x++) for (let y = x + 1; y <= limit; y++) {
        if (x * y % (x + y) === 0) count++;
    }
    return count;
}
it.each([0, 1, 2, 5, 6, 7, 8, 9, 14, 15, 16, 23, 24, 25, 26, 27, 35, 36, 37,
    63, 64, 65, 124, 125, 126, 215, 216, 217, 999, 1000])('counts the original equation through %s on all backends', limit => {
    const expected = reference(limit);
    for (const options of backends) {
        const runtime = new Interpreter(() => {}, { ...options, args: [`--l=${limit}`] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(expected);
        } finally { runtime.dispose(); }
    }
});
it('checks full and partial row boundaries against direct divisor pairs', () => {
    for (const options of backends) {
        const runtime = new Interpreter(() => {}, options);
        try {
            runtime.execute(source.replace('arg L integer = 1000000000000', 'L = 0'));
            for (const n of [0, 1, 5, 6, 7, 8, 15, 16, 17, 26, 27, 28, 63, 64, 65, 124, 125, 126, 999, 1000, 1001, 4095, 4096, 4097]) {
                let expected = 0n;
                for (let a = 2; a * (a + 1) <= n; a++) for (let b = a + 1; b < 2 * a; b++) expected += BigInt(Math.floor(n / (a * b)));
                expect(runtime.execute(`${n} pair_count`)).toBe(expected);
            }
        } finally { runtime.dispose(); }
    }
});
it('retains the full answer with no speculative overflow', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(runtime.variables.get('Answer')).toBe(5435004633092n);
        expect(diagnostics.numberLoops).toBeGreaterThan(1000);
        expect(diagnostics.numberLoopOverflows).toBe(0);
        // Only the global Mobius and quotient tables need publication.
        expect(diagnostics.typedArrayPublications).toBeLessThan(30);
    } finally { runtime.dispose(); }
}, 60000);
it('retains imported captures across the fixture runs on all backends', () => {
    const fixture = new URL('../../../demos/euler/454_diophantinereciprocals_test.ra', import.meta.url);
    for (const options of backends) {
        const results: { passed: boolean }[] = [];
        const runtime = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
            loadModule(specifier) {
                expect(specifier).toBe('454_diophantinereciprocals');
                return { id: new URL('454_diophantinereciprocals.ra', fixture).pathname, source };
            }, onTestResult: result => results.push(result) });
        try {
            runtime.execute(readFileSync(fixture, 'utf8'));
            expect(results.map(result => result.passed)).toEqual([true, true]);
        } finally { runtime.dispose(); }
    }
}, 60000);
