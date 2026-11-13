import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/375_subseqmin.ra', import.meta.url), 'utf8');
function program(limit: number, period: number) {
    return source.replace('arg Limit integer = 2000000000', `Limit = ${limit}`)
        .replace('arg Period integer = 6308948', `Period = ${period}`);
}

function reference(limit: number, period: number): bigint {
    let seed = 290797n;
    const values = Array.from({ length: period }, () => seed = seed * seed % 50515093n);
    let answer = 0n;
    for (let start = 0; start < limit; start++) {
        let minimum = values[start % period];
        for (let end = start; end < limit; end++) {
            if (values[end % period] < minimum) minimum = values[end % period];
            answer += minimum;
        }
    }
    return answer;
}

it.each([{}, { numberLoopCompilation: false }, { compilation: false }])('matches enumerated periodic subsequence minima (%j)', options => {
    const runtime = new Interpreter(() => {}, options);
    try {
        for (const period of [1, 2, 5, 10]) {
            for (const limit of [period, period + 1, 2 * period, 3 * period + 2]) {
                runtime.execute(program(limit, period));
                expect(answerOf(runtime), `Limit=${limit}, Period=${period}`).toBe(reference(limit, period));
            }
        }
    } finally { runtime.dispose(); }
});

it.each([{}, { numberLoopCompilation: false }])('keeps packed-array and wide-answer cases exact (%j)', options => {
    const runtime = new Interpreter(() => {}, options);
    try {
        runtime.execute(program(10000, 10000));
        expect(answerOf(runtime)).toBe(3264567774119n);
        runtime.execute(program(2000000000, 1));
        expect(answerOf(runtime)).toBe(629527n * 2000000000n * 2000000001n / 2n);
    } finally { runtime.dispose(); }
});

function generated(period: number): number[] {
    let value = 290797n;
    return Array.from({ length: period }, () => Number(value = value * value % 50515093n));
}
// Each ending position explicitly visits every subarray ending there.
// This oracle uses neither a stack nor the periodic warm-up formula.
function sums(values: number[], limit: number): bigint[] {
    const result = [0n];
    for (let end = 0; end < limit; end++) {
        let low = Infinity, total = result[end];
        for (let start = end; start >= 0; start--) {
            low = Math.min(low, values[start % values.length]);
            total += BigInt(low);
        }
        result.push(total);
    }
    return result;
}
function input(limit: number, period: number): string {
    return source.replace('arg Limit integer = 2000000000', `Limit = ${limit}`)
        .replace('arg Period integer = 6308948', `Period = ${period}`);
}
function synthetic(values: number[], limit: number): string {
    const code = input(limit, values.length);
    const begin = code.indexOf('Mod ='), end = code.indexOf('rem A zero excess');
    const low = Math.min(...values);
    return code.slice(0, begin) + `A = array shape ${values.length} fill 0\n`
        + values.map((value, i) => `A ${i} = ${value}`).join('\n')
        + `\nLow = ${low}\nK = ${values.indexOf(low)}\n` + code.slice(end);
}

it.each([false, true])('matches independent minima across period boundaries (compilation=%s)', compilation => {
    const r = new Interpreter(() => {}, { compilation });
    try {
        for (let period = 1; period <= 20; period++) {
            const expected = sums(generated(period), 4 * period);
            const limits = new Set([-2, 0, 1, period - 1, period, period + 1,
                2 * period - 1, 2 * period, 2 * period + 1, 3 * period + Math.floor(period / 2)]);
            for (const limit of limits) {
                r.execute(input(limit, period));
                expect(answerOf(r), `P=${period},N=${limit}`).toBe(expected[Math.max(0, limit)]);
            }
        }
        // Existing fixture goldens remain explicit regression checks.
        for (const [limit, expected] of [[10, 432256955n], [10000, 3264567774119n]] as const) {
            r.execute(input(limit, limit));
            expect(answerOf(r)).toBe(expected);
        }
    } finally { r.dispose(); }
});

it.each([false, true])('handles tied minima and forces actual stack growth (compilation=%s)', compilation => {
    const r = new Interpreter(() => {}, { compilation });
    try {
        const patterns = [[5], [3, 3, 3], [1, 4, 2, 1, 5], [5, 4, 3, 2, 1],
            [1, 2, 3, 4, 5], [2, 0, 4, 0, 1], [4, 2, 1, 3, 5], [-3, 2, -3, 4]];
        for (const values of patterns) {
            const expected = sums(values, 3 * values.length + 1);
            for (let limit = 0; limit < expected.length; limit++) {
                r.execute(synthetic(values, limit));
                expect(answerOf(r)).toBe(expected[limit]);
            }
        }
        // A strictly increasing period needs more than the initial 64 slots.
        const values = Array.from({ length: 300 }, (_, i) => i + 1), limit = 601;
        const d = new RuntimeDiagnostics();
        d.run(() => r.execute(synthetic(values, limit)));
        expect(answerOf(r)).toBe(sums(values, limit)[limit]);
        expect(r.execute('St len')).toBe(512n);
        if (compilation) {
            expect(d.numberLoops).toBe(1);
            expect(d.numberLoopOverflows).toBe(0);
        }
    } finally { r.dispose(); }
});

it('computes the full golden with two Number loops and a growing stack', () => {
    const r = new Interpreter(() => {}), d = new RuntimeDiagnostics();
    try {
        d.run(() => r.execute(source));
        expect(answerOf(r)).toBe(7435327983715286168n);
        expect(r.execute('St len')).toBe(64n);
        expect(d.numberLoops).toBe(2);
        expect(d.numberLoopOverflows).toBe(0);
        expect(d.mixedIntegerLoops).toBe(0);
    } finally { r.dispose(); }
}, 30000);
