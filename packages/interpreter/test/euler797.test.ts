import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/797_cyclogenic.ra', import.meta.url), 'utf8');

// Compute cyclotomic factors and divisor products with exact BigInts.
// No prime sieve, modular inverse or doubling shifts from the demo.
function reference(limit: number, mod: bigint) {
    const phi = [0n], primitive = [0n];
    let total = 0n;
    for (let n = 1; n <= limit; n++) {
        let factor = (1n << BigInt(n)) - 1n, product = 1n, previous = 0n;
        for (let d = 1; d < n; d++) if (n % d === 0) {
            factor /= phi[d];
            product *= 1n + phi[d];
            previous += primitive[d];
        }
        phi.push(factor);
        primitive.push(product * (1n + factor) - previous);
        total += primitive[n];
    }
    return total % mod;
}

it('reproduces the published Q10 example independently', () => {
    expect(reference(10, 1000000007n)).toBe(5598n);
});
describe.each([false, true])('Euler 797 compilation=%s', compilation => {
    it.each([1, 2, 10, 31, 64, 100])('matches exact divisor products at Limit=%s', limit => {
        const runtime = new Interpreter(() => {}, { compilation, args: [`--limit=${limit}`] });
        try {
            runtime.execute(source);
            expect(answerOf(runtime)).toBe(reference(limit, 1000000007n));
        } finally { runtime.dispose(); }
    });
    it.each([97n, 2305843009213693951n])('preserves modular arithmetic for modulus %s', mod => {
        const runtime = new Interpreter(() => {}, { compilation, args: ['--limit=10', `--mod=${mod}`] });
        try {
            runtime.execute(source);
            expect(answerOf(runtime)).toBe(reference(10, mod));
        } finally { runtime.dispose(); }
    });
});
it('compiles all three unchanged prime sieves', () => {
    const runtime = new Interpreter(() => {}, { args: ['--limit=1000'] });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(answerOf(runtime)).toBe(reference(1000, 1000000007n));
        expect(diagnostics.numberLoops).toBe(3);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    } finally { runtime.dispose(); }
});
