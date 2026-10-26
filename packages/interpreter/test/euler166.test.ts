import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/166_crisscross.ra', import.meta.url), 'utf8');

// Enumerate three actual rows and derive the fourth from the column sums.
// No packed keys, pair join, counter, or complementary-sum symmetry.
function oracle(base: number): bigint {
    const groups: number[][][] = Array.from({ length: 4 * (base - 1) + 1 }, () => []);
    for (let a = 0; a < base; a++) for (let b = 0; b < base; b++)
        for (let c = 0; c < base; c++) for (let d = 0; d < base; d++) groups[a + b + c + d].push([a, b, c, d]);
    let answer = 0n;
    for (let s = 0; s < groups.length; s++) for (const a of groups[s])
        for (const b of groups[s]) for (const c of groups[s]) {
            const d = a.map((cell, i) => s - cell - b[i] - c[i]);
            if (d.some(cell => cell < 0 || cell >= base) || d.reduce((n, x) => n + x, 0) !== s) continue;
            if (a[0] + b[1] + c[2] + d[3] === s && a[3] + b[2] + c[1] + d[0] === s) answer++;
        }
    return answer;
}

describe.each([false, true])('Euler 166 (compilation=%s)', compilation => {
    it.each([2, 3, 4, 5])('matches a direct grid oracle for Base=%i', base => {
        const output: string[] = [];
        const r = new Interpreter(line => output.push(line), { compilation, args: [`--base=${base}`] });
        try {
            r.execute(source);
            const answer = oracle(base);
            expect(r.variables.get('Answer')).toBe(answer);
            expect(output).toEqual([String(answer)]);
        } finally { r.dispose(); }
    });
});

it('compiles both counter consumers over each retained sum', () => {
    const r = new Interpreter(() => {}, { args: ['--base=4'] });
    try {
        const d = new RuntimeDiagnostics();
        d.run(() => r.execute(source));
        expect(r.variables.get('Answer')).toBe(5400n);
        expect(d.compiledCounterBuilds).toBe(7);
        expect(d.compiledCounterSums).toBe(7);
    } finally { r.dispose(); }
});
