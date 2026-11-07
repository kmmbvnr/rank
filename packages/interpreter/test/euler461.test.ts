import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import type { RankArray } from '../src/value.js';
const source = readFileSync(new URL('../../../demos/euler/461_almostpi.ra', import.meta.url), 'utf8');
const scale = 10n ** 60n;
function atanInverse(base: bigint) {
    let power = scale / base, sum = 0n;
    for (let i = 0; power; i++) {
        const term = power / BigInt(2 * i + 1);
        sum += i % 2 ? -term : term;
        power /= base * base;
    }
    return sum;
}
const pi = 16n * atanInverse(5n) - 4n * atanInverse(239n);
const absolute = (x: bigint) => x < 0n ? -x : x;
function oracle(n: number) {
    const limit = Math.floor(n * Math.log(Math.PI + 1)) + 1;
    const terms = Array.from({ length: limit + 1 }, (_, k) => {
        let term = scale, sum = 0n;
        for (let order = 1; order <= 160; order++) {
            term = term * BigInt(k) / BigInt(n * order);
            sum += term;
        }
        return sum;
    });
    let best: bigint | undefined, answer = 0n;
    for (let a = 0; a <= limit; a++) for (let b = a; b <= limit; b++)
        for (let c = b; c <= limit; c++) for (let d = c; d <= limit; d++) {
            const error = absolute(terms[a] + terms[b] + terms[c] + terms[d] - pi);
            if (best === undefined || error < best) { best = error; answer = BigInt(a*a+b*b+c*c+d*d); }
        }
    return answer;
}
function solve(n: number, options: object = {}, chunk = 262144) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`, `--c=${chunk}`] });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        const winning = runtime.variables.get('Winning') as RankArray;
        return { answer: runtime.variables.get('Answer'), winning: Array.from(winning.items), diagnostics };
    } finally { runtime.dispose(); }
}
it.each([1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20])('matches exhaustive 60-digit search at N=%s on every backend', n => {
    const expected = oracle(n);
    for (const options of [{}, { compilation: false }, { numberLoopCompilation: false }]) expect(solve(n, options).answer).toBe(expected);
});
it.each([127, 4096, 1000000])('keeps fixture answers across ragged chunk boundaries (chunk=%s)', chunk => {
    for (const options of [{}, { compilation: false }, { numberLoopCompilation: false }])
        expect(solve(200, options, chunk).answer).toBe(64658n);
});
it('retains the N=1000 fixture on all backends', () => {
    for (const options of [{}, { compilation: false }, { numberLoopCompilation: false }]) expect(solve(1000, options).answer).toBe(1519860n);
});
it('retains the full answer and the winning terms', () => {
    const result = solve(10000);
    expect(result.answer).toBe(159820276n);
    expect(result.winning.map(Number).sort((a,b) => a-b)).toEqual([1433,2147,4903,11363]);
    expect(result.diagnostics.numberLoops).toBeGreaterThan(0);
    expect(result.diagnostics.numberLoopOverflows).toBe(0);
}, 120000);
