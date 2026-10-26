import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/154_pascalpyramid.ra', import.meta.url), 'utf8');
// Exact multinomial coefficients: independent of valuation tables, pruning,
// and the ordered-triple symmetry used by the demo.
function oracle(n: number, power: number): bigint {
    const factorial = [1n];
    for (let i = 1; i <= n; i++) factorial[i] = factorial[i - 1] * BigInt(i);
    const divisor = 10n ** BigInt(power);
    let answer = 0n;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
        if (factorial[n] / (factorial[i] * factorial[j] * factorial[n - i - j]) % divisor === 0n) answer++;
    }
    return answer;
}

describe.each([false, true])('Euler 154 (compilation=%s)', compilation => {
    it.each([[0, 0], [1, 0], [2, 1], [5, 1], [20, 1], [25, 2], [100, 3],
        [124, 3], [125, 3], [126, 3], [300, 5], [500, 6], [624, 6], [625, 6], [626, 6]])(
        'agrees with exact coefficients for N=%i, Power=%i', (n, power) => {
            const output: string[] = [];
            const r = new Interpreter(line => output.push(line), { compilation, args: [`--n=${n}`, `--power=${power}`] });
            try {
                r.execute(source);
                const answer = oracle(n, power);
                expect(r.variables.get('Answer')).toBe(answer);
                expect(output).toEqual([String(answer)]);
            } finally { r.dispose(); }
        });
});

it('keeps the candidate traversal and inner search in one Number region', () => {
    const r = new Interpreter(() => {}, { args: ['--n=500', '--power=6'] });
    const d = new RuntimeDiagnostics();
    try {
        d.run(() => r.execute(source));
        expect(r.variables.get('Answer')).toBe(6762n);
        expect(d.numberLoops).toBe(1);
        expect(d.compiledLoops).toBe(1);
        expect(d.numberLoopOverflows).toBe(0);
    } finally { r.dispose(); }
});
