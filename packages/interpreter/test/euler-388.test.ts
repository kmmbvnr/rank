import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import type { RankArray } from '../src/value.js';

const source = readFileSync(new URL('../../../demos/euler/388_lines.ra', import.meta.url), 'utf8');
function mobius(value: number) {
    let sign = 1;
    for (let p = 2; p * p <= value; p++) {
        if (value % p) continue;
        value /= p; sign = -sign;
        if (value % p === 0) return 0;
    }
    return value > 1 ? -sign : sign;
}
function direct(n: number) {
    let total = 0n;
    for (let d = 1; d <= n; d++) {
        const q = BigInt(Math.floor(n / d));
        total += BigInt(mobius(d)) * ((q + 1n) ** 3n - 1n);
    }
    return total;
}

describe.each([false, true])('Euler 388 quotient tables (compilation=%s)', compilation => {
    it('matches trial-factorization Mobius sums across quotient and cutoff boundaries', () => {
        for (const n of [0, 1, 2, 6, 8, 15, 40, 99, 100, 127, 256]) {
            const expected = direct(n);
            for (const cut of [0, 1, Math.max(1, Math.floor(Math.sqrt(n))), n + 10]) {
                const runtime = new Interpreter(() => {}, { compilation, args: [`--n=${n}`, `--cut=${cut}`] });
                try {
                    runtime.execute(source);
                    expect(runtime.variables.get('Answer'), `N=${n}, Cut=${cut}`).toBe(expected);
                    const root = runtime.variables.get('Root') as bigint;
                    expect(runtime.variables.get('Top') as bigint).toBeLessThanOrEqual(root);
                    expect(runtime.variables.get('Bound') as bigint).toBeGreaterThanOrEqual(root);
                    expect(runtime.variables.get('Bound') as bigint).toBeLessThanOrEqual(BigInt(Math.max(1, n)));
                } finally { runtime.dispose(); }
            }
        }
    });

    it('reproduces the statement checkpoint with a tiny cutoff and compact tables', () => {
        const runtime = new Interpreter(() => {}, { compilation, args: ['--n=1000000', '--cut=1'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(831909254469114121n);
            expect(runtime.variables.get('Token')).toBe('831909254469114121');
            expect((runtime.variables.get('Mu') as RankArray).shape).toEqual([1001]);
            expect((runtime.variables.get('Cache') as RankArray).shape).toEqual([1000]);
        } finally { runtime.dispose(); }
    });
});
