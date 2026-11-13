import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { withoutReturn } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/320_factorials.ra', import.meta.url), 'utf8');
const helpers = withoutReturn(source.slice(source.indexOf('fun P Target Prev minimum')));
const k = 1234567890n, modulus = 10n ** 18n;

function valuation(n: bigint, p: bigint): bigint {
    let sum = 0n;
    while (n > 0n) { n /= p; sum += n; }
    return sum;
}
function inverse(p: bigint, target: bigint): bigint {
    let low = 0n, high = p * target;
    while (low < high) {
        const mid = (low + high) / 2n;
        if (valuation(mid, p) >= target) high = mid;
        else low = mid + 1n;
    }
    return low;
}

// Recompute every prime constraint from each factorial; no incremental
// exponent table, covered-prime pruning or greedy inverse is shared.
function directSum(upper: number): bigint {
    let result = 0n;
    for (let i = 10; i <= upper; i++) {
        let best = 0n;
        for (let p = 2; p <= i; p++) {
            let prime = true;
            for (let d = 2; d * d <= p; d++) if (p % d === 0) { prime = false; break; }
            if (!prime) continue;
            const need = inverse(BigInt(p), k * valuation(BigInt(i), BigInt(p)));
            if (need > best) best = need;
        }
        result = (result + best) % modulus;
    }
    return result;
}
const bounds = [0, 1, 9, 10, 20, 50, 100];
const expected = new Map(bounds.map(upper => [upper, directSum(upper)]));

for (const mode of ['reference', 'compiled', 'exact'] as const) describe(`Euler 320 (${mode})`, () => {
    const options = { compilation: mode !== 'reference', numberLoopCompilation: mode !== 'exact' };
    it('matches binary-search inversion, including carry digits and wide integers', () => {
        const runtime = new Interpreter(() => {}, options);
        try {
            runtime.execute(helpers);
            for (const p of [2n, 3n, 5n, 97n, 999983n]) {
                const targets = [...Array.from({ length: 32 }, (_, i) => BigInt(i)), 1234567890n, 9007199254740993n];
                for (const target of targets) {
                    const minimum = inverse(p, target);
                    for (const previous of new Set([0n, minimum / 2n, minimum, minimum + 1n])) {
                        runtime.variables.set('Prime', p);
                        runtime.variables.set('Target', target);
                        runtime.variables.set('Previous', previous);
                        expect(runtime.execute('Prime Target Previous minimum')).toBe(previous > minimum ? previous : minimum);
                    }
                }
            }
        } finally { runtime.dispose(); }
    });
    it.each(bounds)('matches independent factorial constraints at Upper=%i', upper => {
        const runtime = new Interpreter(() => {}, options);
        try {
            runtime.variables.set('Upper', BigInt(upper));
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(expected.get(upper));
        } finally { runtime.dispose(); }
    });
    it('retains the statement checkpoint', () => {
        const runtime = new Interpreter(() => {}, options);
        try {
            runtime.variables.set('Upper', 1000n);
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(614538266565663n);
        } finally { runtime.dispose(); }
    });
});

it('retains the full compiled Euler 320 answer', () => {
    const runtime = new Interpreter(() => {});
    try {
        runtime.execute(source);
        expect(runtime.variables.get('Answer')).toBe(278157919195482643n);
        expect(runtime.variables.get('Best')).toBe(1234559248024796n);
    } finally { runtime.dispose(); }
});
