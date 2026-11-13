import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/452_longproducts.ra', import.meta.url), 'utf8');
const modulus = 1234567891n;
function choose(n: bigint, k: number) {
    let value = 1n;
    for (let i = 1; i <= k; i++) value = value * (n - BigInt(i) + 1n) / BigInt(i);
    return value;
}
// Factor every product directly, without quotient tables or recursive splitting.
function reference(limit: number, length: bigint) {
    let total = 0n;
    for (let value = 1; value <= limit; value++) {
        let rest = value, ways = 1n;
        for (let prime = 2; prime * prime <= rest; prime++) {
            let exponent = 0;
            while (rest % prime === 0) { rest /= prime; exponent++; }
            if (exponent) ways *= choose(length + BigInt(exponent) - 1n, exponent);
        }
        if (rest > 1) ways *= length;
        total += ways;
    }
    return total % modulus;
}
const cases = [0, 1, 2, 3, 4, 8, 9, 10, 15, 16, 17, 31, 32, 33, 63, 64, 65, 100, 127, 128, 129, 1000]
    .flatMap(limit => [0n, 1n, 2n, 10n, 1000000000n, modulus + 3n].map(length => ({ limit, length })));
it.each(cases)('counts products through $limit in $length slots on all backends', ({ limit, length }) => {
    const expected = reference(limit, length);
    for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
        const runtime = new Interpreter(() => {}, { ...options, args: [`--m=${limit}`, `--n=${length}`] });
        try {
            runtime.execute(source);
            expect(answerOf(runtime)).toBe(expected);
        } finally { runtime.dispose(); }
    }
});
it('retains the full answer and compiles the private prime tables', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(answerOf(runtime)).toBe(345558983n);
        expect(diagnostics.numberLoops).toBe(2);
        expect(diagnostics.numberLoopOverflows).toBe(0);
        expect(diagnostics.bulkArrayWriteCells).toBeLessThan(100);
        expect((runtime.variables.get('Low') as RankArray).shape).toEqual([31623]);
    } finally { runtime.dispose(); }
}, 60000);
it('retains imported captures across both fixture runs', () => {
    const fixture = new URL('../../../demos/euler/452_longproducts_test.ra', import.meta.url);
    for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
        const results: { passed: boolean }[] = [];
        const runtime = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
            loadModule(specifier) {
                expect(specifier).toBe('452_longproducts');
                return { id: new URL('452_longproducts.ra', fixture).pathname, source };
            }, onTestResult: result => results.push(result) });
        try {
            runtime.execute(readFileSync(fixture, 'utf8'));
            expect(results.map(result => result.passed)).toEqual([true, true]);
        } finally { runtime.dispose(); }
    }
}, 60000);
