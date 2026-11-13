import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type InterpreterOptions } from '../src/index.js';
import { answerOf } from './support.js';

const fixture = new URL('../../../demos/euler/522_hiddenchains_test.ra', import.meta.url);
const source = readFileSync(new URL('522_hiddenchains.ra', fixture), 'utf8');
const modes: InterpreterOptions[] = [{}, { compilation: false }, { numberLoopCompilation: false }];
// Enumerate all legal wiring graphs and all Hamiltonian cycles, then minimize
// the number of changed outgoing edges. No factorial identity is used here.
function enumerate(n: number): bigint {
    if (n < 2) return 0n;
    const cycles: number[][] = [];
    function cycle(order: number[]) {
        if (order.length === n) {
            const next = Array<number>(n);
            order.forEach((v, i) => next[v] = order[(i + 1) % n]); cycles.push(next); return;
        }
        for (let v = 1; v < n; v++) if (!order.includes(v)) cycle([...order, v]);
    }
    cycle([0]); let total = 0n;
    function graph(edges: number[]) {
        if (edges.length === n) {
            total += BigInt(Math.min(...cycles.map(next => next.reduce((count, v, i) => count + Number(v !== edges[i]), 0)))); return;
        }
        for (let v = 0; v < n; v++) if (v !== edges.length) graph([...edges, v]);
    }
    graph([]); return total;
}
const brute = Array.from({ length: 7 }, (_, n) => enumerate(n));
const mod = 135707531n;
function power(base: bigint, exponent: bigint): bigint {
    let result = 1n;
    while (exponent) { if (exponent & 1n) result = result * base % mod; base = base * base % mod; exponent >>= 1n; }
    return result;
}
// Independent direct integer factorial divisions. No modular inverses,
// products scans or chunk carries; each term is exact before reduction.
function formula(n: number): bigint {
    if (n < 3) return 0n;
    const factorial = [1n];
    for (let i = 1; i <= n; i++) factorial[i] = factorial[i - 1] * BigInt(i);
    let total = BigInt(n * (n - 1)) * power(BigInt(n - 2), BigInt(n - 1));
    for (let m = 2; m <= n - 2; m++) total += factorial[n] / (factorial[m] * BigInt(n - m)) * power(BigInt(m - 1), BigInt(m));
    return total % mod;
}
const inputs = [...Array.from({ length: 15 }, (_, n) => n), 17, 31, 32, 33, 64, 99, 100, 101, 127, 255, 256, 257, 1000];
const expected = new Map(inputs.map(n => [n, formula(n)]));
it('checks the factorial formula against graph rewiring enumeration', () => {
    expect(brute).toEqual(Array.from({ length: 7 }, (_, n) => formula(n)));
    expect(expected.get(8)).toBe(16276736n); expect(expected.get(100)).toBe(84326147n);
});
it.each(modes)('retains exact sums across block boundaries with %j', options => {
    for (const n of inputs) {
        const r = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
        try { r.execute(source.replace('Block = 65536', 'Block = 7')); expect(answerOf(r), `N=${n}`).toBe(expected.get(n)); }
        finally { r.dispose(); }
    }
}, 30_000);
it.each(modes)('retains the statement fixture with %j', options => {
    const results: boolean[] = [];
    const r = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
        loadModule: () => ({ id: new URL('522_hiddenchains.ra', fixture).pathname, source }),
        onTestResult: result => results.push(result.passed) });
    try { r.execute(readFileSync(fixture, 'utf8')); expect(results).toEqual([true]); }
    finally { r.dispose(); }
});
it('compiles the chunked scan/power region', () => {
    const r = new Interpreter(() => {}, { args: ['--n=100'] }), d = new RuntimeDiagnostics();
    try { d.run(() => r.execute(source.replace('Block = 65536', 'Block = 7'))); expect(answerOf(r)).toBe(84326147n); expect(d.numberLoops).toBe(1); expect(d.numberLoopOverflows).toBe(0); }
    finally { r.dispose(); }
});
