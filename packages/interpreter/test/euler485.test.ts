import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
import { answerOf } from './support.js';
const fixture = new URL('../../../demos/euler/485_maxdivisors_test.ra', import.meta.url);
const source = readFileSync(new URL('485_maxdivisors.ra', fixture), 'utf8');
const backends: InterpreterOptions[] = [{}, { compilation: false }, { numberLoopCompilation: false }];
function brute(limit: number, width: number): bigint {
    // Count actual divisors, then inspect every window independently.
    const counts = new Uint16Array(limit + 1);
    for (let d = 1; d <= limit; d++) for (let n = d; n <= limit; n += d) counts[n]++;
    let sum = 0n;
    for (let start = 1; start + width - 1 <= limit; start++) {
        let max = 0;
        for (let n = start; n < start + width; n++) max = Math.max(max, counts[n]);
        sum += BigInt(max);
    }
    return sum;
}
it.each([
    [0, 1, 7], [1, 1, 1], [2, 1, 1], [9, 2, 1], [31, 5, 3],
    [64, 7, 11], [81, 10, 10], [128, 33, 7], [200, 200, 17],
    [200, 201, 31], [1000, 10, 77], [1000, 17, 103], [10000, 100, 777],
])('matches direct windows: U=%s K=%s Bs=%s', (limit, width, block) => {
    const expected = brute(limit, width);
    for (const options of backends) {
        const r = new Interpreter(() => {}, { ...options, args: [`--u=${limit}`, `--k=${width}`, `--bs=${block}`] });
        try { r.execute(source); expect(answerOf(r)).toBe(expected); }
        finally { r.dispose(); }
    }
});
it.each(backends)('preserves statement and cross-block fixtures with %j', options => {
    const results: boolean[] = [];
    const r = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
        loadModule(specifier) { expect(specifier).toBe('485_maxdivisors'); return { id: new URL('485_maxdivisors.ra', fixture).pathname, source }; },
        onTestResult: result => results.push(result.passed) });
    try { r.execute(readFileSync(fixture, 'utf8')); expect(results).toEqual([true, true]); }
    finally { r.dispose(); }
});
it('matches the full independent sieve and deque oracle', () => {
    const r = new Interpreter(() => {});
    try { r.execute(source); expect(answerOf(r)).toBe(51281274340n); }
    finally { r.dispose(); }
}, 120000);
