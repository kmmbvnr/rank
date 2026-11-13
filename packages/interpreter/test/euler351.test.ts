import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/351_orchards.ra', import.meta.url), 'utf8');
const helpers = source.slice(0, source.indexOf('\nAnswer ='));
const top = 1_000_000;
const phi = Uint32Array.from({ length: top + 1 }, (_, i) => i);
for (let p = 2; p <= top; p++) if (phi[p] === p) {
    for (let v = p; v <= top; v += p) phi[v] -= phi[v] / p;
}
const sums = new Float64Array(top + 1);
for (let i = 1; i <= top; i++) sums[i] = sums[i - 1] + phi[i];
const inputs = new Set(Array.from({ length: 301 }, (_, i) => i));
for (const n of [999, 1000, 1001, 9999, 10000, 10001, 65535, 65536, 65537,
    100000, 100001, 100003, 250000, 999983, top]) inputs.add(n);
let seed = 1234567;
for (let i = 0; i < 20; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    inputs.add(1 + seed % 100000);
}

for (const compilation of [false, true]) {
    it(`matches an independent totient sieve (${compilation})`, () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(helpers);
            for (const n of inputs) {
                const expected = 6n * (BigInt(n) * BigInt(n + 1) / 2n - BigInt(sums[n]));
                expect(runtime.execute(`${n} hidden`), `N=${n}`).toBe(expected);
            }
            expect(() => runtime.execute('-1 hidden')).toThrow();
        } finally { runtime.dispose(); }
    }, 15_000);

    it(`preserves the full orchard answer (${compilation})`, () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source);
            expect(answerOf(runtime)).toBe(11762187201804552n);
        } finally { runtime.dispose(); }
    }, 45_000);
}
