import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type NativeFunction, type InterpreterOptions } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/556_squarefreegaussian.ra', import.meta.url), 'utf8');

// Enumerate Gaussian square divisors directly, without the Mobius formula.
function oracle(limit: number) {
    const squares: [number, number, number][] = [];
    const bound = Math.floor(Math.sqrt(limit)), root = Math.floor(Math.sqrt(bound));
    for (let c = 0; c <= root; c++) for (let d = -root; d <= root; d++) {
        const norm = c * c + d * d;
        if (norm > 1 && norm <= bound) squares.push([c * c - d * d, 2 * c * d, norm * norm]);
    }
    let total = 0;
    for (let a = 1; a <= bound; a++) for (let b = 0; a * a + b * b <= limit; b++) {
        if (!squares.some(([real, imag, norm]) => (a * real + b * imag) % norm === 0 && (b * real - a * imag) % norm === 0)) total++;
    }
    return BigInt(total);
}
function solve(n: number, options: InterpreterOptions) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    try { runtime.execute(source); return runtime.variables.get('Answer'); }
    finally { runtime.dispose(); }
}
describe.each([{}, { compilation: false }, { numberLoopCompilation: false }])('Euler 556 %j', options => {
    it.each([0, 1, 2, 3, 4, 5, 10, 25, 50, 100, 256, 500, 1000])('matches Gaussian square divisors through %s', n => {
        expect(solve(n, options)).toBe(oracle(n));
    });
    it.each([[10000, 5218n], [100000000, 52126906n]])('matches the statement at %s', (n, expected) => {
        expect(solve(n, options)).toBe(expected);
    });
    it('matches the full result', () => expect(solve(100000000000000, options)).toBe(52126939292957n), 30000);
    it('counts quarter discs at square boundaries', () => {
        const runtime = new Interpreter(() => {}, { ...options, args: ['--n=0'] });
        try {
            runtime.execute(source);
            const fn = runtime.variables.get('disc') as NativeFunction;
            for (const n of [0, 1, 2, 3, 4, 8, 9, 15, 16, 17, 24, 25, 26, 100]) {
                let count = 0;
                for (let a = 1; a * a <= n; a++) for (let b = 0; a * a + b * b <= n; b++) count++;
                expect(fn.call([BigInt(n)])).toBe(BigInt(count));
            }
        } finally { runtime.dispose(); }
    });
});
