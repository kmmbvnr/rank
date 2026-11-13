import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, type InterpreterOptions } from '../src/index.js';
import { answerOf } from './support.js';

const fixture = new URL('../../../demos/euler/519_tricolouredcoin_test.ra', import.meta.url);
const source = readFileSync(new URL('519_tricolouredcoin.ra', fixture), 'utf8');
const modes: InterpreterOptions[] = [{}, { compilation: false }, { numberLoopCompilation: false }];
const aboveMemo = new Map<string, bigint>();
// Enumerate supported coin positions and proper colours directly. The two
// touching supporting coins force each upper coin's third colour.
function above(row: number[], left: number): bigint {
    if (!left) return 1n;
    if (row.length < 2) return 0n;
    const key = `${row}/${left}`, known = aboveMemo.get(key);
    if (known !== undefined) return known;
    const options: number[] = [];
    for (let i = 0; i < row.length - 1; i++) if (row[i] >= 0 && row[i + 1] >= 0) options.push(i);
    let total = 0n;
    for (let mask = 1; mask < 2 ** options.length; mask++) {
        const next = Array<number>(row.length - 1).fill(-1);
        let count = 0;
        for (let bit = 0; bit < options.length; bit++) if (mask & 2 ** bit) {
            const i = options[bit]; next[i] = 3 - row[i] - row[i + 1]; count++;
        }
        if (count > left || next.some((color, i) => color >= 0 && color === next[i + 1])) continue;
        total += above(next, left - count);
    }
    aboveMemo.set(key, total); return total;
}
function fountains(n: number): bigint {
    if (!n) return 0n;
    let total = 0n;
    for (let width = 1; width <= n; width++) {
        function colors(row: number[]): void {
            if (row.length === width) { total += above(row, n - width); return; }
            for (let color = 0; color < 3; color++) if (row.at(-1) !== color) colors([...row, color]);
        }
        colors([]);
    }
    return total;
}
const small = Array.from({ length: 13 }, (_, n) => fountains(n));
// Independent scalar partition updates and a quadratic BigInt quotient
// recurrence: no axis scans, Newton iteration, convolution or NTT.
function coefficients(limit: number): bigint[] {
    const mod = 1000000000n, normalize = (x: bigint) => (x % mod + mod) % mod;
    const rows = Array<bigint>(limit + 1).fill(0n), upper = [...rows], lower = [...rows]; rows[0] = 1n;
    for (let order = 0, sign = 1n; order * (order + 1) <= limit; order++, sign = -sign) {
        const first = order * (order + 2), last = order * (order + 1);
        for (let i = 0; i + first <= limit; i++) upper[i + first] = normalize(upper[i + first] + sign * rows[i]);
        for (let i = 0; i + last <= limit; i++) lower[i + last] = normalize(lower[i + last] + sign * rows[i]);
        const step = order + 1;
        for (let i = step; i <= limit; i++) rows[i] = normalize(rows[i] + rows[i - step]);
    }
    const p = upper.map((x, i) => normalize(2n * x - lower[i]));
    const q = lower.map((x, i) => normalize(x - (i ? 2n * p[i - 1] : 0n)));
    const values = Array<bigint>(limit + 1).fill(0n);
    for (let i = 1; i <= limit; i++) {
        let value = p[i - 1];
        for (let k = 1; k <= i; k++) value -= q[k] * values[i - k];
        values[i] = normalize(value);
    }
    return values.map(value => normalize(3n * value));
}
const expected = coefficients(1234);
const inputs = [...small.map((_, n) => n), 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 255, 256, 257, 1234];
it('checks the scalar recurrence against explicit coloured fountains', () => {
    expect(small[4]).toBe(48n); expect(small[10]).toBe(17760n);
    expect(expected.slice(0, small.length)).toEqual(small);
    expect(expected[1234]).toBe(881371376n);
});
it.each(modes)('matches direct enumeration and scalar quotient coefficients with %j', options => {
    for (const n of inputs) {
        const r = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
        try {
            r.execute(source); expect(answerOf(r), `N=${n}`).toBe(expected[n]);
            const inverse = r.variables.get('Inverse')!;
            expect(isRankArray(inverse) && inverse.shape).toEqual([n + 1]);
        }
        finally { r.dispose(); }
    }
}, 30_000);
it.each(modes)('retains the statement fixture with %j', options => {
    const results: boolean[] = [];
    const r = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
        loadModule: () => ({ id: new URL('519_tricolouredcoin.ra', fixture).pathname, source }),
        onTestResult: result => results.push(result.passed) });
    try { r.execute(readFileSync(fixture, 'utf8')); expect(results).toEqual([true]); }
    finally { r.dispose(); }
});
it('compiles the strided q-series prefix loop', () => {
    const r = new Interpreter(() => {}, { args: ['--n=1234'] }), d = new RuntimeDiagnostics();
    try { d.run(() => r.execute(source)); expect(answerOf(r)).toBe(881371376n); expect(d.numberLoops).toBe(1); expect(d.cellsComputed).toBe(0); }
    finally { r.dispose(); }
});
