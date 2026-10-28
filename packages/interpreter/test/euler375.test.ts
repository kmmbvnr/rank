import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

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
                expect(runtime.variables.get('Answer'), `Limit=${limit}, Period=${period}`).toBe(reference(limit, period));
            }
        }
    } finally { runtime.dispose(); }
});

it.each([{}, { numberLoopCompilation: false }])('keeps packed-array and wide-answer cases exact (%j)', options => {
    const runtime = new Interpreter(() => {}, options);
    try {
        runtime.execute(program(10000, 10000));
        expect(runtime.variables.get('Answer')).toBe(3264567774119n);
        runtime.execute(program(2000000000, 1));
        expect(runtime.variables.get('Answer')).toBe(629527n * 2000000000n * 2000000001n / 2n);
    } finally { runtime.dispose(); }
});
