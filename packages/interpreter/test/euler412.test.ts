import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/412_gnomonnumbering.ra', import.meta.url), 'utf8');
function solve(m: number, k: number, compilation: boolean, chunk = 4000000) {
    const runtime = new Interpreter(() => {}, { compilation, args: [`--m=${m}`, `--k=${k}`, `--chunk=${chunk}`] });
    try { runtime.execute(source); return runtime.variables.get('Answer'); }
    finally { runtime.dispose(); }
}

// Every hook is counted directly, independently of the ratio of factorials.
function oracle(m: number, k: number) {
    const width = m - k;
    const rows = Array.from({ length: m }, (_, y) => y < width ? m : width);
    let factorial = 1n, hooks = 1n;
    for (let i = 1; i <= m * m - k * k; i++) factorial *= BigInt(i);
    for (let y = 0; y < m; y++) for (let x = 0; x < rows[y]; x++) {
        let below = 0;
        for (let j = y + 1; j < m; j++) if (x < rows[j]) below++;
        hooks *= BigInt(rows[y] - x + below);
    }
    return factorial / hooks % 76543217n;
}

describe.each([false, true])('Euler 412 (compilation=%s)', compilation => {
    it('matches exact hook counts for squares, thin arms and short chunks', () => {
        for (let m = 1; m <= 12; m++) for (let k = 0; k < m; k++) {
            expect(solve(m, k, compilation, 7), `M=${m}, K=${k}`).toBe(oracle(m, k));
        }
    }, 30000);
    it('preserves the full answer through the shorter factorial tail', () => {
        expect(solve(10000, 5000, compilation)).toBe(38788800n);
    }, 30000);
    it('handles a large tail and a factorial containing the modulus', () => {
        // These goldens were checked against the original forward product.
        expect(solve(6200, 0, compilation)).toBe(45711240n);
        expect(solve(9000, 0, compilation)).toBe(0n);
    }, 30000);
});
