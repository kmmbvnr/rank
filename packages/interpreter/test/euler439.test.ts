import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/439_sumofdivisors.ra', import.meta.url), 'utf8');
function oracle(n: number) {
    const sigma = new Int32Array(n * n + 1);
    for (let divisor = 1; divisor < sigma.length; divisor++)
        for (let multiple = divisor; multiple < sigma.length; multiple += divisor) sigma[multiple] += divisor;
    let sum = 0n;
    for (let a = 1; a <= n; a++) for (let b = 1; b <= n; b++) sum += BigInt(sigma[a * b]);
    return sum % 1000000000n;
}
for (const n of [0, 1, 2, 3, 4, 8, 9, 10, 16, 25, 49, 80, 100]) {
    it(`matches direct divisor enumeration at N=${n} with small and full tables`, () => {
        const expected = oracle(n);
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
            for (const l of [1, 1000]) {
                const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`, `--l=${l}`] });
                try {
                    runtime.execute(source);
                    expect(answerOf(runtime)).toBe(expected);
                } finally { runtime.dispose(); }
            }
        }
    });
}
