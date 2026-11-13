import { fullScale } from './full-scale.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/549_divisibilityfactorials.ra', import.meta.url), 'utf8');
// Independent oracle: multiply factorial residues until n divides m!.
const sums = [0n, 0n];
for (let n = 2; n <= 2000; n++) {
    let residue = 1n, m = 1n;
    while (residue !== 0n) { m++; residue = residue * m % BigInt(n); }
    sums[n] = sums[n - 1] + m;
}
function solve(n: number, options: InterpreterOptions, block = 1048576) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    try { runtime.execute(source.replace('Block = 1048576', `Block = ${block}`)); return answerOf(runtime); }
    finally { runtime.dispose(); }
}
const modes = [
    { name: 'Number', options: {} },
    { name: 'exact', options: { numberLoopCompilation: false } },
    { name: 'reference', options: { compilation: false } },
];
describe.each(modes)('Euler 549 $name', ({ options }) => {
    it.each([0, 1, 2, 3, 4, 7, 8, 9, 15, 16, 24, 25, 26, 27, 31, 32, 48, 49, 50, 63, 64, 100, 1000, 2000])
        ('matches factorial residues through %s', n => expect(solve(n, options)).toBe(sums[n]));
    it.each([1, 7, 16, 64])('matches independent residues across blocks of %s', block => expect(solve(1000, options, block)).toBe(sums[1000]));
    fullScale('matches the full sum', () => expect(solve(100000000, options)).toBe(476001479068717n), 120000);
});
