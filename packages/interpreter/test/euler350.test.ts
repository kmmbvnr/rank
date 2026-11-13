import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/350_constraining.ra', import.meta.url), 'utf8');
const helpers = source.slice(0, source.indexOf('\nAnswer ='));
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
const cases: [number, number, number, bigint][] = [];
// Enumerate actual ordered tuples, independently of the multiplicative formula.
for (let l = 1; l <= 12; l++) for (let n = 1; n <= 4; n++) {
    const counts = Array<bigint>(l + 1).fill(0n);
    function visit(left: number, g: number, m: number) {
        if (!left) { counts[g]++; return; }
        for (let a = 1; a <= l; a++) {
            const next = m * a / gcd(m, a);
            if (next <= l) visit(left - 1, gcd(g, a), next);
        }
    }
    visit(n, 0, 1);
    let sum = 0n;
    for (let g = l; g >= 1; g--) { sum += counts[g]; cases.push([g, l, n, sum]); }
}
for (const n of [1, 2, 3]) cases.push([10, 5, n, 0n]);

for (const compilation of [false, true]) it(`matches independent tuple enumeration (${compilation})`, () => {
    const runtime = new Interpreter(() => {}, { compilation });
    try {
        runtime.execute(helpers);
        for (const [g, l, n, answer] of cases) expect(runtime.execute(`${g} ${l} ${n} constrained`)).toBe(answer);
    } finally { runtime.dispose(); }
});

it('retains larger inputs across the library sieve boundary', () => {
    const runtime = new Interpreter(() => {});
    try {
        runtime.execute(helpers);
        for (const top of [1048575, 1048576, 1100000]) expect(runtime.execute(`1 ${top} 1 constrained`)).toBe(BigInt(top));
    } finally { runtime.dispose(); }
}, 15_000);

it('preserves the full constrained-list answer', () => {
    const runtime = new Interpreter(() => {});
    try {
        runtime.execute(source);
        expect(answerOf(runtime)).toBe(84664213n);
    } finally { runtime.dispose(); }
}, 15_000);
