import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import type { RankArray } from '../src/value.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/464_mobiusintervals.ra', import.meta.url), 'utf8');
const backends = [{}, { compilation: false }, { numberLoopCompilation: false }];
function mobius(n: number) {
    if (!n) return 0;
    let sign = 1;
    for (let prime = 2; prime*prime <= n; prime++) {
        if (n % prime) continue;
        n /= prime; sign = -sign;
        if (n % prime === 0) return 0;
    }
    return n > 1 ? -sign : sign;
}
function brute(signs: number[]) {
    let count = 0n;
    for (let start = 1; start < signs.length; start++) {
        let plus = 0, minus = 0;
        for (let end = start; end < signs.length; end++) {
            if (signs[end] === 1) plus++;
            if (signs[end] === -1) minus++;
            if (99*minus <= 100*plus && 99*plus <= 100*minus) count++;
        }
    }
    return count;
}
function solve(n: number, options: object = {}, check?: (runtime: Interpreter) => void) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        check?.(runtime);
        return { answer: answerOf(runtime), diagnostics };
    } finally { runtime.dispose(); }
}
it.each([0,1,2,3,4,5,8,9,10,16,17,25,49,100,199,300,500])('matches trial-factor Möbius values and exhaustive intervals at N=%s', n => {
    const signs = Array.from({ length: n+1 }, (_, k) => mobius(k)), expected = brute(signs);
    for (const options of backends) expect(solve(n, options, runtime => {
        const compressed = Array.from((runtime.variables.get('Signs') as RankArray).items, Number);
        const weights = Array.from((runtime.variables.get('Weights') as RankArray).items, Number);
        expect(weights.length).toBe(compressed.length+1);
        expect(weights.every(x => x > 0)).toBe(true);
        expect(weights.reduce((a,b) => a+b, 0)).toBe(n+1);
        const restored = Array<number>(n+1).fill(0);
        let position = weights[0];
        compressed.forEach((sign,i) => { restored[position] = sign; position += weights[i+1]; });
        expect(restored).toEqual(signs);
    }).answer).toBe(expected);
});
it.each([
    { signs: [], weights: [100] },
    { signs: [1,-1,1], weights: [2,1,3,4] },
    { signs: [...Array<number>(100).fill(1), ...Array<number>(99).fill(-1)] },
    { signs: [...Array<number>(99).fill(-1), ...Array<number>(100).fill(1)] },
    { signs: [...Array<number>(101).fill(1), ...Array<number>(99).fill(-1)] },
])('keeps strict ratio boundaries and weighted zero runs: %s', data => {
    const weights = data.weights ?? Array<number>(data.signs.length+1).fill(1);
    const n = weights.reduce((a,b) => a+b, 0)-1, expanded = Array<number>(n+1).fill(0);
    let position = weights[0];
    data.signs.forEach((sign,i) => { expanded[position] = sign; position += weights[i+1]; });
    const expectedBad = BigInt(n*(n+1)/2)-brute(expanded);
    for (const options of backends) {
        const runtime = new Interpreter(() => {}, options);
        try {
            runtime.execute(source.split('unpack Signs Weights = N signs')[0]);
            runtime.execute(`Signs = ${data.signs.length ? 'array '+data.signs.join(' ') : 'array shape 0 fill 0'}\nWeights = array ${weights.join(' ')}`);
            expect(runtime.execute('Signs violations Weights')).toBe(expectedBad);
        } finally { runtime.dispose(); }
    }
});
it('retains imported captures across both fixture runs on every backend', () => {
    const fixture = new URL('../../../demos/euler/464_mobiusintervals_test.ra', import.meta.url);
    for (const options of backends) {
        const results: { passed: boolean }[] = [];
        const runtime = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
            loadModule(specifier) {
                expect(specifier).toBe('464_mobiusintervals');
                return { id: new URL('464_mobiusintervals.ra', fixture).pathname, source };
            }, onTestResult: result => results.push(result) });
        try {
            runtime.execute(readFileSync(fixture, 'utf8'));
            expect(results.map(result => result.passed)).toEqual([true, true]);
        } finally { runtime.dispose(); }
    }
});
it('retains the full twenty-million answer with all three loops in Number mode', () => {
    const result = solve(20000000);
    expect(result.answer).toBe(198775297232878n);
    expect(result.diagnostics.numberLoops).toBe(3);
    expect(result.diagnostics.numberLoopOverflows).toBe(0);
}, 120000);
