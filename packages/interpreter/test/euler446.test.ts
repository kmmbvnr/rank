import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/446_retractionsb.ra', import.meta.url), 'utf8');
const modulus = 1000000007n;
// Factor n^4 + 4 directly, independently of the demo's quadratic sieve.
const totals = [0n];
for (let n = 1n; n <= 100n; n++) {
    const value = n ** 4n + 4n;
    let rest = value, unitary = 1n;
    for (let p = 2n; p * p <= rest; p++) {
        let power = 1n;
        while (rest % p === 0n) { rest /= p; power *= p; }
        if (power > 1n) unitary *= power + 1n;
    }
    if (rest > 1n) unitary *= rest + 1n;
    totals.push((totals.at(-1)! + unitary - value) % modulus);
}

it.each([0, 1, 2, 3, 4, 10, 31, 32, 63, 64, 65, 99, 100])(
    'matches direct factorization for Euler 446 at %s on all backends', limit => {
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
            const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${limit}`] });
            try {
                runtime.execute(source);
                expect(answerOf(runtime)).toBe(totals[limit]);
            } finally { runtime.dispose(); }
        }
    });

it('keeps interval halos and empty factor groups correct on all backends', () => {
    for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
        const runtime = new Interpreter(() => {}, { ...options, args: ['--n=100'] });
        try {
            runtime.execute(source);
            for (const [start, stop] of [[1, 1], [2, 2], [3, 7], [8, 16], [31, 32], [63, 65], [99, 100]]) {
                expect(runtime.execute(`arg N integer = 100\n${start} block ${stop}`))
                    .toBe((totals[stop] - totals[start - 1] + modulus) % modulus);
            }
        } finally { runtime.dispose(); }
    }
});

it('compiles shrinking prime-power extraction as one fresh-array region', () => {
    const runtime = new Interpreter(() => {}, { args: ['--n=1024'] });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(answerOf(runtime)).toBe(376757876n);
        expect(diagnostics.numberLoops).toBe(3);
        expect(diagnostics.numberLoopOverflows).toBe(0);
        expect(diagnostics.numberLoopCopyProbes).toBe(0);
    } finally { runtime.dispose(); }
});

it('preserves the full default Euler 446 answer', () => {
    const runtime = new Interpreter(() => {});
    try {
        runtime.execute(source);
        expect(answerOf(runtime)).toBe(907803852n);
    } finally { runtime.dispose(); }
}, 60000);
