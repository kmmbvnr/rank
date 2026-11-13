import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type InterpreterOptions } from '../src/index.js';
import { answerOf } from './support.js';
const fixture = new URL('../../../demos/euler/476_circlepacking_test.ra', import.meta.url);
const source = readFileSync(new URL('476_circlepacking.ra', fixture), 'utf8');
const backends: InterpreterOptions[] = [{}, { compilation: false }, { numberLoopCompilation: false }];
function direct(n: number) {
    let total = 0, count = 0;
    for (let a = 1; a <= n / 2; a++) for (let b = a; b <= n - a; b++) for (let c = b; c < a + b; c++) {
        const s = (a + b + c) / 2, sides = [a, b, c];
        const r2 = (s - a) * (s - b) * (s - c) / s;
        const ratios = sides.map((_, i) => {
            const sine = Math.sqrt((s - sides[(i + 1) % 3]) * (s - sides[(i + 2) % 3]) / (sides[(i + 1) % 3] * sides[(i + 2) % 3]));
            return (1 - sine) / (1 + sine);
        }).sort((a, b) => b - a);
        const third = Math.max(ratios[1], ratios[0] ** 2);
        total += r2 * (1 + ratios[0] ** 2 + third ** 2); count++;
    }
    return { answer: Number((total * Math.PI / count).toFixed(5)), count: BigInt(count) };
}
function solve(n: number, options: InterpreterOptions) {
    const r = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] }), d = new RuntimeDiagnostics();
    try {
        d.run(() => r.execute(source));
        return { answer: answerOf(r), count: r.variables.get('Count'), d };
    } finally { r.dispose(); }
}
it.each([2, 3, 4, 5, 6, 9, 10, 11, 25, 50, 51])('matches explicit Heron/all-corner triangles at N=%s', n => {
    const expected = direct(n);
    for (const options of backends) {
        const actual = solve(n, options);
        expect(actual.answer).toBe(expected.answer); expect(actual.count).toBe(expected.count);
    }
});
it.each(backends)('retains imported examples with options=%j', options => {
    const results: boolean[] = [];
    const r = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
        loadModule(specifier) { expect(specifier).toBe('476_circlepacking'); return { id: new URL('476_circlepacking.ra', fixture).pathname, source }; },
        onTestResult: result => results.push(result.passed) });
    try { r.execute(readFileSync(fixture, 'utf8')); expect(results).toEqual([true, true]); } finally { r.dispose(); }
});
it('checks the full average and triangle count with a compiled real array helper', () => {
    const actual = solve(1803, {});
    expect(actual.answer).toBe(110242.87794); expect(actual.count).toBe(244623302n);
    expect(actual.d.numberLoops).toBe(1);
}, 60000);
