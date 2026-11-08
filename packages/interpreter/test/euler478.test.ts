import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, type InterpreterOptions } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
const fixture = new URL('../../../demos/euler/478_mixtures_test.ra', import.meta.url);
const source = readFileSync(new URL('478_mixtures.ra', fixture), 'utf8');
const backends: InterpreterOptions[] = [{}, { compilation: false }, { numberLoopCompilation: false }];
const modulus = 214358881n;
function gcd(a: number, b: number): number { while (b) [a, b] = [b, a % b]; return a; }
function power(exponent: bigint): bigint {
    let result = 1n, base = 2n;
    for (; exponent; exponent >>= 1n, base = base * base % modulus) if (exponent & 1n) result = result * base % modulus;
    return result;
}
function direct(n: number) {
    let primitive = 0n;
    for (let a = 0; a <= n; a++) for (let b = 0; b <= n; b++) for (let c = 0; c <= n; c++) {
        if (gcd(gcd(a, b), c) === 1) primitive++;
    }
    const phi = [0n], counts = [1n];
    for (let slope = 1; slope <= n; slope++) {
        let totient = 0n, count = 1n;
        for (let x = 1; x <= slope; x++) if (gcd(x, slope) === 1) totient++;
        for (let x = 1; x <= n; x++) for (let y = 1; x + slope * y <= n; y++) if (gcd(x, y) === 1) count++;
        phi.push(totient); counts.push(count);
    }
    const half = (primitive - 1n) / 2n;
    let total = 0n, sum = 0n;
    for (let i = 1; i <= n; i++) { sum += phi[i]; total += 6n * phi[i] * power(half - counts[i]); }
    const answer = ((power(primitive) - 1n - power(half) * 6n * sum + total) % modulus + modulus) % modulus;
    return { primitive, phi, counts, answer };
}
function solve(n: number, options: InterpreterOptions, check?: (r: Interpreter) => void) {
    const r = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] }), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => r.execute(source)); check?.(r);
        return { answer: r.variables.get('Answer'), primitive: r.variables.get('Primitive'), diagnostics };
    } finally { r.dispose(); }
}
it.each([1, 2, 3, 4, 5, 7, 9, 10, 16, 20])('matches primitive triples and coprime lattice counts at N=%s', n => {
    const expected = direct(n);
    for (const options of backends) {
        const actual = solve(n, options, r => {
            for (const [name, cells] of [['Phi', expected.phi], ['Counts', expected.counts]] as const) {
                const value = r.variables.get(name);
                if (!value || !isRankArray(value)) throw Error(`expected ${name} array`);
                expect(value.shape).toEqual([n + 1]);
                expect(cells.map((_, index) => readArrayItem(value, index))).toEqual(cells);
            }
        });
        expect(actual.answer).toBe(expected.answer); expect(actual.primitive).toBe(expected.primitive);
    }
});
it.each(backends)('retains statement examples with options=%j', options => {
    const results: boolean[] = [];
    const r = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
        loadModule(specifier) { expect(specifier).toBe('478_mixtures'); return { id: new URL('478_mixtures.ra', fixture).pathname, source }; },
        onTestResult: result => results.push(result.passed) });
    try { r.execute(readFileSync(fixture, 'utf8')); expect(results).toEqual([true, true]); } finally { r.dispose(); }
});
it('checks the full mixture count with bounded exponent residues and two numeric loops', () => {
    const actual = solve(10000000, {}, r => {
        expect(r.variables.get('Sum')).toBe(30396356427242n);
        const counts = r.variables.get('Counts');
        if (!counts || !isRankArray(counts)) throw Error('expected Counts');
        expect(readArrayItem(counts, 1)).toBe(30396356427242n);
        expect(readArrayItem(counts, 10000000)).toBe(1n);
    });
    expect(actual.answer).toBe(59510340n); expect(actual.primitive).toBe(831907565456419587823n);
    expect(actual.diagnostics.numberLoops).toBe(2);
}, 60000);
