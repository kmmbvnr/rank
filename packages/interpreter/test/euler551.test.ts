import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
import { isRankArray, isRankRecord } from '../src/value.js';
const source = readFileSync(new URL('../../../demos/euler/551_sumofdigitssequence.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler551-original.ra', import.meta.url), 'utf8');
const sums = (n: number) => { let sum = 0; for (; n; n = Math.floor(n / 10)) sum += n % 10; return sum; };
const values = [1n, 1n];
for (let n = 2, value = 1; n <= 1000000; n++) { value += sums(value); values[n] = BigInt(value); }
function solve(n: number | string, options: InterpreterOptions, program = source) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    try { runtime.execute(program); return runtime.variables.get('Answer'); }
    finally { runtime.dispose(); }
}
const modes = [{ name: 'Number', options: {} }, { name: 'exact', options: { numberLoopCompilation: false } }, { name: 'reference', options: { compilation: false } }];
describe.each(modes)('Euler 551 $name', ({ options }) => {
    it.each([0, 1, 2, 3, 4, 5, 8, 9, 10, 15, 16, 99, 100, 101, 999, 1000, 1001, 10000, 1000000])('matches literal digit-sum iteration at %s', n => expect(solve(n, options)).toBe(values[n]));
    it('matches the full exact result beyond Number precision', () => expect(solve('1000000000000000', options)).toBe(73597483551591773n));
    it('keeps the original program correct after the compiler repair', () => expect(solve('1000000000000000', options, original)).toBe(73597483551591773n));
    it('handles an input beyond Number precision against a separate BigInt decimal-block oracle', () => expect(solve('10000000000000000', options)).toBe(783810210313609037n));
    it('counts block transitions against direct simulation, including zero-step overshoot', () => {
        const runtime = new Interpreter(() => {}, { ...options, args: ['--n=10000'] });
        try {
            runtime.execute(source);
            const history = runtime.variables.get('History');
            if (history === undefined || !isRankArray(history)) throw Error('missing history');
            for (const d of [0, 1, 2, 3]) {
                const record = readArrayItem(history, d);
                if (!isRankRecord(record)) throw Error('missing table');
                const steps = record.entries.get('steps'), rests = record.entries.get('rests');
                if (!steps || !rests || !isRankArray(steps) || !isRankArray(rests)) throw Error('missing transition matrices');
                const size = steps.shape[1];
                for (const c of [0, 1, 3, 9]) for (const r of [0, 1, 2, 9, 10, 30, 50]) {
                    if (c === 0 && r === 0) continue;
                    let value = r, count = 0;
                    while (value < 10 ** d) { value += c + sums(value); count++; }
                    expect(readArrayItem(steps, c * size + r)).toBe(BigInt(count));
                    expect(readArrayItem(rests, c * size + r)).toBe(BigInt(value - 10 ** d));
                }
            }
        } finally { runtime.dispose(); }
    });
});
