import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/445_retractionsa.ra', import.meta.url), 'utf8');

// Factor exact binomial coefficients independently of the demo's SPF walk.
function retractions(limit: number): bigint {
    let choose = 1n, total = 0n;
    for (let k = 1; k < limit; k++) {
        choose = choose * BigInt(limit - k + 1) / BigInt(k);
        let rest = choose, unitary = 1n;
        for (let prime = 2n; prime <= BigInt(limit); prime++) {
            let power = 1n;
            while (rest % prime === 0n) { rest /= prime; power *= prime; }
            if (power > 1n) unitary *= power + 1n;
        }
        expect(rest).toBe(1n);
        total += unitary - choose;
    }
    return total % 1000000007n;
}

it.each([0, 1, 2, 3, 10, 31, 32, 63, 64, 65, 99, 100, 101])(
    'matches exact unitary divisors for Euler 445 at %s on all execution backends', limit => {
        const expected = retractions(limit);
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
            const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${limit}`] });
            try {
                runtime.execute(source);
                expect(answerOf(runtime)).toBe(expected);
            } finally { runtime.dispose(); }
        }
    });

it('compiles the sieve and the factor walk without copying their large tables', () => {
    const runtime = new Interpreter(() => {}, { args: ['--n=100000'] });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(answerOf(runtime)).toBe(628701600n);
        expect(diagnostics.numberLoops).toBe(2);
        expect(diagnostics.numberLoopOverflows).toBe(0);
        expect(diagnostics.numberLoopCopyProbes).toBe(1);
        expect(diagnostics.numberLoopCopyAmortized).toBe(1);
        // The speculative snapshot covers small-prime exponents only.
        expect(diagnostics.costs['number-loop.snapshot'].copiedBytes).toBeLessThan(100000);
        // Only the small power grid needs copy-on-write.
        expect(diagnostics.cowCopiedCells).toBeLessThan(100000);
    } finally { runtime.dispose(); }
});

it('preserves the full default Euler 445 answer', () => {
    const runtime = new Interpreter(() => {});
    try {
        runtime.execute(source);
        expect(answerOf(runtime)).toBe(659104042n);
    } finally { runtime.dispose(); }
}, 30000);
