import { fullScale } from './full-scale.js';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/680_yarragnisrever.ra', import.meta.url), 'utf8');
function run(n: bigint, k: number, compilation = true) {
    const r = new Interpreter(() => {}, { compilation });
    try {
        r.execute(source.replace('arg Nn integer = 1000000000000000000', `arg Nn integer = ${n}`)
            .replace('arg Kk integer = 1000000', `arg Kk integer = ${k}`));
        return r.variables.get('Answer');
    } finally { r.dispose(); }
}
function reference(n: number, k: number) {
    const a = Array.from({ length: n }, (_, i) => BigInt(i));
    let x = 1n % BigInt(n), y = x;
    for (let j = 0; j < k; j++) {
        const lo = Number(x < y ? x : y), hi = Number(x > y ? x : y);
        a.splice(lo, hi - lo + 1, ...a.slice(lo, hi + 1).reverse());
        [x, y] = [(x + y) % BigInt(n), (x + 2n * y) % BigInt(n)];
    }
    return a.reduce((sum, x, i) => sum + BigInt(i) * x, 0n) % 1000000000n;
}
it('matches independent flat reversals including empty workloads, endpoints and repeated cuts', () => {
    for (const compilation of [false, true]) for (const n of [1, 2, 5, 19, 100]) for (const k of [0, 1, 4, 37]) {
        expect(run(BigInt(n), k, compilation), `${n}, ${k}, ${compilation}`).toBe(reference(n, k));
    }
});
it('keeps the published reduced examples and the huge unreversed sum exact', () => {
    expect(run(5n, 4)).toBe(27n);
    expect(run(100n, 100)).toBe(246597n);
    expect(run(10000n, 10000)).toBe(275481640n);
    const n = 1000000000000000000n;
    expect(run(n, 0)).toBe(n * (n - 1n) * (2n * n - 1n) / 6n % 1000000000n);
});
fullScale('keeps the full Euler 680 answer', () => {
    expect(run(1000000000000000000n, 1000000)).toBe(563917241n);
}, 180_000);
