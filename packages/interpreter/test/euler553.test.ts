import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/553_powersetsofpowersets.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler553-original.ra', import.meta.url), 'utf8');
function enumerate(n: number): bigint[] {
    const counts = Array<bigint>(n + 1).fill(0n);
    for (let family = 0; family < 2 ** (2 ** n - 1); family++) {
        const parent = Array.from({ length: n }, (_, i) => i);
        const root = (i: number): number => parent[i] === i ? i : root(parent[i]);
        let used = 0;
        for (let set = 1; set < 2 ** n; set++) if (family & 2 ** (set - 1)) {
            used |= set;
            const members = parent.map((_, i) => i).filter(i => set & (1 << i));
            for (const i of members) parent[root(i)] = root(members[0]);
        }
        const components = new Set(parent.map((_, i) => i).filter(i => used & (1 << i)).map(root)).size;
        counts[components]++;
    }
    return counts;
}
const counts = Array.from({ length: 5 }, (_, n) => enumerate(n));
function solve(n: number, k: number, options: InterpreterOptions, program = source) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`, `--k=${k}`] });
    try { runtime.execute(program); return answerOf(runtime); }
    finally { runtime.dispose(); }
}
const cases = counts.flatMap((row, n) => [...row, 0n].map((answer, k) => ({ n, k, answer })));
const modes = [{ name: 'Number', options: {} }, { name: 'exact', options: { numberLoopCompilation: false } },
    { name: 'reference', options: { compilation: false } }];
describe.each(modes)('Euler 553 $name', ({ options }) => {
    it.each(cases)('matches exhaustive set-family enumeration at n=$n k=$k', ({ n, k, answer }) => {
        expect(solve(n, k, options)).toBe(answer);
    });
    it.each([[7, 2], [17, 1], [33, 3], [50, 10], [100, 10], [129, 2]])('matches the old coefficient recurrence at %s / %s', (n, k) => {
        expect(solve(n, k, options)).toBe(solve(n, k, options, original));
    });
    it('matches the full answer', () => expect(solve(10000, 10, options)).toBe(57717170n));
    it('uses only the needed degree when K is close to N', () => {
        const n = 1000000;
        expect(solve(n, n, options)).toBe(1n);
        expect(solve(n, n - 1, options)).toBe((2n * BigInt(n) ** 2n - BigInt(n)) % 1000000007n);
    });
});
