import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
import { answerOf } from './support.js';

const fixture = new URL('../../../demos/euler/495_distinctproduct_test.ra', import.meta.url);
const source = readFileSync(new URL('495_distinctproduct.ra', fixture), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler495-original.ra', import.meta.url), 'utf8');
const modes: InterpreterOptions[] = [{}, { compilation: false }, { numberLoopCompilation: false }];

// Enumerate strictly increasing factors of n!, independently of partitions
// of k, symmetric polynomials, prime exponents or generating functions.
function brute(n: number, k: number): bigint {
    let factorial = 1;
    for (let value = 2; value <= n; value++) factorial *= value;
    const memo = new Map<string, bigint>();
    function count(rest: number, least: number, slots: number): bigint {
        if (!slots) return rest === 1 ? 1n : 0n;
        if (slots === 1) return rest >= least ? 1n : 0n;
        const key = `${rest}/${least}/${slots}`;
        if (memo.has(key)) return memo.get(key)!;
        let total = 0n;
        for (let first = least; ; first++) {
            let minimum = 1;
            for (let offset = 0; offset < slots; offset++) minimum *= first + offset;
            if (minimum > rest) break;
            if (rest % first === 0) total += count(rest / first, first + 1, slots - 1);
        }
        memo.set(key, total);
        return total;
    }
    return count(factorial, 1, k);
}
const small = Array.from({ length: 10 }, (_, n) => Array.from({ length: 6 }, (_, k) => ({ n, k, answer: brute(n, k) }))).flat();
it.each(modes)('matches direct distinct-factor enumeration with %j', options => {
    const r = new Interpreter(() => {}, options);
    try {
        r.execute(source.replace('arg N integer = 10000', 'arg N integer = 0').replace('arg K integer = 30', 'arg K integer = 0'));
        for (const { n, k, answer } of small) expect(r.execute(`${n} solve ${k}`), `N=${n}, K=${k}`).toBe(answer);
    } finally { r.dispose(); }
});
it.each(modes)('matches the original nontrivial fixtures with %j', options => {
    for (const [n, k, answer] of [[100, 10, 287549200n], [1000, 20, 840203305n]] as const) {
        for (const program of [original, source]) {
            const r = new Interpreter(() => {}, { ...options, args: [`--n=${n}`, `--k=${k}`] });
            try { r.execute(program); expect(answerOf(r)).toBe(answer); }
            finally { r.dispose(); }
        }
    }
});
it.each(modes)('retains the statement fixture with %j', options => {
    const results: boolean[] = [];
    const r = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
        loadModule: () => ({ id: new URL('495_distinctproduct.ra', fixture).pathname, source }),
        onTestResult: result => results.push(result.passed) });
    try { r.execute(readFileSync(fixture, 'utf8')); expect(results).toEqual([true]); }
    finally { r.dispose(); }
});
it('retains the original full answer', () => {
    const r = new Interpreter(() => {});
    try { r.execute(source); expect(answerOf(r)).toBe(789107601n); }
    finally { r.dispose(); }
}, 120_000);
