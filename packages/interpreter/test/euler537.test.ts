import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/537_primecounting.ra', import.meta.url), 'utf8');
const modulus = 1004535809n;

function primes(count: number): number[] {
    const values: number[] = [];
    for (let n = 2; values.length < count; n++) {
        let prime = true;
        for (const p of values) { if (p * p > n) break; if (n % p === 0) { prime = false; break; } }
        if (prime) values.push(n);
    }
    return values;
}
function reference(n: number, k: number): bigint {
    const ps = primes(n + 1), weights = [1n, ...ps.slice(1).map((p, i) => BigInt(p - ps[i]))];
    let counts = Array<bigint>(n + 1).fill(0n); counts[0] = 1n;
    for (let step = 0; step < k; step++) {
        const next = Array<bigint>(n + 1).fill(0n);
        for (let a = 0; a <= n; a++) for (let b = 0; a + b <= n; b++) next[a + b] = (next[a + b] + counts[a] * weights[b]) % modulus;
        counts = next;
    }
    return counts[n];
}
function answer(n: number, k: number, options: InterpreterOptions = {}) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`, `--k=${k}`] });
    try { runtime.execute(source); return runtime.variables.get('Answer'); }
    finally { runtime.dispose(); }
}
const modes = [
    {name: 'Number', options: {}},
    {name: 'exact', options: {numberLoopCompilation: false}},
    {name: 'reference', options: {compilation: false}},
];
describe.each(modes)('Euler 537 $name', ({options}) => {
    it.each([[0, 0], [0, 7], [1, 0], [1, 1], [3, 3], [5, 2], [10, 10], [19, 7], [65, 13]])('matches independent repeated coefficient sums for n=%s k=%s', (n, k) => {
        expect(answer(n, k, options)).toBe(reference(n, k));
    });
    it('matches the larger statement example', () => {
        expect(answer(1000, 1000, options)).toBe(578270566n);
    });
    it('matches the full result', () => {
        expect(answer(20000, 20000, options)).toBe(779429131n);
    });
});
it('does not depend on the old fixed prime bound', () => {
    const ps = primes(30001);
    expect(answer(30000, 1)).toBe(BigInt(ps[30000] - ps[29999]));
});
