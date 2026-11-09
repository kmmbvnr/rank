import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/530_gcddivisors.ra', import.meta.url), 'utf8');
// Enumerate divisors and their complementary factors directly, without the
// totient identity, hyperbola method, cube split or segmented sieve.
function brute(limit: number) {
    const totals = new Array<bigint>(limit + 1).fill(0n);
    const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
    for (let n = 1; n <= limit; n++) {
        let total = totals[n - 1];
        for (let d = 1; d <= n; d++) if (n % d === 0) total += BigInt(gcd(d, n / d));
        totals[n] = total;
    }
    return totals;
}
const expected = brute(10000);
describe.each([
    { name: 'Number', options: {} },
    { name: 'exact compiled', options: { numberLoopCompilation: false } },
    { name: 'reference', options: { compilation: false } },
])('Euler 530 $name', ({ options }) => {
    it.each([0, 1, 2, 7, 8, 9, 10, 26, 27, 28, 63, 64, 65, 999, 1000, 1001, 10000])(
        'matches divisor enumeration at N=%s', n => {
            const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
            try { runtime.execute(source); expect(runtime.variables.get('Answer')).toBe(expected[n]); }
            finally { runtime.dispose(); }
        });
    it('matches across multiple block boundaries', () => {
        // Exercise the real partitioning cheaply: shrink only the storage block,
        // keeping the same arithmetic and independent semantic oracle.
        const runtime = new Interpreter(() => {}, { ...options, args: ['--n=10000'] });
        try {
            runtime.execute(source.replace('Block = 1048576', 'Block = 13'));
            expect(runtime.variables.get('Answer')).toBe(expected[10000]);
        } finally { runtime.dispose(); }
    });
});
it('keeps the exact full-scale result with compiled array stages', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(runtime.variables.get('Answer')).toBe(207366437157977206n);
        expect(diagnostics.numberLoops).toBeGreaterThan(0);
        expect(diagnostics.mixedIntegerLoops).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
}, 120_000);
