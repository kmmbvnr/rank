import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/529_tensum.ra', import.meta.url), 'utf8');
// Direct semantic oracle: enumerate decimal integers and mark every digit
// covered by every interval with the target sum. No automaton, bit-state
// transitions, minimization, recurrence inference or polynomial evaluation.
function brute() {
    const totals = new Uint32Array(11), coverage = new Uint32Array(11);
    const results = new Map<number, number[]>();
    let endpoint = 1, exponent = 0;
    for (let n = 1; n <= 100000; n++) {
        const digits = Array.from(String(n), Number);
        const full = (1 << digits.length) - 1;
        coverage.fill(0);
        for (let start = 0; start < digits.length; start++) {
            let sum = 0;
            for (let end = start; end < digits.length; end++) {
                sum += digits[end];
                if (sum > 10) break;
                coverage[sum] |= (1 << (end + 1)) - (1 << start);
            }
        }
        for (let sum = 0; sum <= 10; sum++) if (coverage[sum] === full) totals[sum]++;
        if (n === endpoint) {
            results.set(exponent++, [...totals]);
            endpoint *= 10;
        }
    }
    return results;
}
const counts = brute();
const modes = [
    { name: 'Number', options: {} },
    { name: 'exact compiled', options: { numberLoopCompilation: false } },
    { name: 'reference', options: { compilation: false } },
];
describe.each(modes)('Euler 529 $name', ({ options }) => {
    it.each([0, 1, 2, 4, 7, 10])('matches digit coverage through five places with target %s', sum => {
        for (const exponent of [0, 1, 2, 3, 5]) {
            const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${exponent}`, `--sd=${sum}`] });
            try {
                runtime.execute(source);
                expect(runtime.variables.get('Answer'), `T(${exponent}), sum=${sum}`).toBe(BigInt(counts.get(exponent)![sum]));
            } finally { runtime.dispose(); }
        }
    }, 120_000);
    it('keeps the existing long sum-four fixture', () => {
        const runtime = new Interpreter(() => {}, { ...options, args: ['--n=2000', '--sd=4'] });
        try { runtime.execute(source); expect(runtime.variables.get('Answer')).toBe(603612384n); }
        finally { runtime.dispose(); }
    });
    it('covers a huge exponent independently as binary decimal strings for target one', () => {
        const exponent = 10n ** 18n, modulus = 1000000007n;
        let expected = 1n, base = 2n;
        for (let power = exponent; power; power >>= 1n, base = base * base % modulus) {
            if (power & 1n) expected = expected * base % modulus;
        }
        const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${exponent}`, '--sd=1'] });
        try { runtime.execute(source); expect(runtime.variables.get('Answer')).toBe(expected); }
        finally { runtime.dispose(); }
    });
    it('handles the zero sequence at an exponent beyond the generated terms', () => {
        const runtime = new Interpreter(() => {}, { ...options, args: ['--n=10000', '--sd=0'] });
        try { runtime.execute(source); expect(runtime.variables.get('Answer')).toBe(0n); }
        finally { runtime.dispose(); }
    });
});
it('matches the full Euler 529 result without Int32 replay', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(runtime.variables.get('Answer')).toBe(23624465n);
        expect(diagnostics.numberLoops).toBeGreaterThan(0);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    } finally { runtime.dispose(); }
}, 120_000);
