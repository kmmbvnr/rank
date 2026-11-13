import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/450_hypocycloid.ra', import.meta.url), 'utf8');
function gcd(a: bigint, b: bigint): bigint {
    a = a < 0n ? -a : a; b = b < 0n ? -b : b;
    while (b) [a, b] = [b, a % b];
    return a;
}
function mobius(limit: number) {
    const mu = Array(limit + 1).fill(1n), prime = Array(limit + 1).fill(true);
    mu[0] = 0n;
    for (let p = 2; p <= limit; p++) {
        if (!prime[p]) continue;
        for (let k = p; k <= limit; k += p) { prime[k] = false; mu[k] *= -1n; }
        for (let k = p * p; k <= limit; k += p * p) mu[k] = 0n;
    }
    return mu;
}
function power(a: bigint, b: bigint, exponent: number) {
    let x = 1n, y = 0n;
    for (let k = 0; k < exponent; k++) [x, y] = [x * a - y * b, x * b + y * a];
    return [x, y];
}
// Retain the original direct Mobius sum and scalar Pythagorean search as an
// independent oracle for the new coefficient sieve, tensor grid and polynomial.
function reference(limit: number) {
    const n = BigInt(limit), root = BigInt(Math.floor(Math.sqrt(limit))), mu = mobius(limit);
    let nontrivial = 0n, trivial = 0n, correction = 0n;
    for (let u = 1n; u * u <= root; u++) for (let v = 1n; v < u; v++) {
        const c = u * u + v * v;
        if (c > root || gcd(u, v) !== 1n || (u + v) % 2n === 0n) continue;
        const a = u * u - v * v, b = 2n * u * v;
        for (const [real, imag] of [[a, b], [-a, b], [b, a], [-b, a]]) {
            for (let order = 3; c ** BigInt(order) <= n * n / 2n; order++) {
                for (let first = 1; first <= (order - 1) / 2; first++) {
                    if (gcd(BigInt(order), BigInt(first)) !== 1n) continue;
                    const second = order - first, left = power(real, imag, first), right = power(real, imag, second);
                    const scale = c ** BigInt(second), ratio = c ** BigInt(second - first);
                    const x = BigInt(second) * left[0] * ratio + BigInt(first) * right[0];
                    const y = BigInt(second) * left[1] * ratio - BigInt(first) * right[1];
                    const common = gcd(scale, gcd(x, y));
                    const size = ((x < 0n ? -x : x) + (y < 0n ? -y : y)) / common;
                    const count = n / (scale / common * BigInt(order));
                    nontrivial += size * count * (count + 1n);
                }
            }
        }
    }
    for (let r = 1n; r <= n; r++) {
        const k = (r - 1n) / 2n;
        trivial += 4n * r * k - k * (k + 1n);
    }
    for (let d = 1; d <= limit; d++) for (let r = d; r <= limit; r += d) {
        if (r < 3) continue;
        const q = n / BigInt(r), h = BigInt(Math.floor(Math.floor(r / 2) / d));
        correction += [1n, 0n, -1n, 0n][r % 4] * q * (q + 1n) / 2n * mu[d] * h * (h + 1n) * BigInt(d);
    }
    return { nontrivial, trivial, correction, answer: nontrivial + trivial + correction };
}

it.each([0, 1, 2, 3, 4, 9, 10, 24, 25, 26, 99, 100, 101, 624, 625, 626, 999, 1000])(
    'matches independent Euler 450 components at %s on all backends', limit => {
        const expected = reference(limit);
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
            const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${limit}`] });
            try {
                runtime.execute(source);
                expect(runtime.variables.get('Nontrivial')).toBe(expected.nontrivial);
                expect(runtime.variables.get('Trivial')).toBe(expected.trivial);
                expect(runtime.variables.get('Correction')).toBe(expected.correction);
                expect(answerOf(runtime)).toBe(expected.answer);
            } finally { runtime.dispose(); }
        }
    });
it('matches every coefficient to its direct divisor sum', () => {
    const mu = mobius(1000);
    const runtime = new Interpreter(() => {}, { args: ['--n=1000'] });
    try {
        runtime.execute(source);
        const weights = runtime.variables.get('Weights') as RankArray;
        expect(weights.items[0]).toBe(0n);
        expect(weights.items[1]).toBe(0n);
        for (let m = 2; m <= 500; m++) {
            let coefficient = 0n;
            for (let d = 1; d <= 2 * m; d++) if (2 * m % d === 0) {
                const h = BigInt(Math.floor(m / d));
                coefficient += mu[d] * BigInt(d) * h * (h + 1n) * (m % 2 ? -1n : 1n);
            }
            expect(weights.items[m]).toBe(coefficient);
        }
    } finally { runtime.dispose(); }
});
it('preserves the full exact Euler 450 answer without Number replay', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(answerOf(runtime)).toBe(583333163984220940n);
        expect(runtime.variables.get('Triples')).toBe(632n);
        expect(diagnostics.numberLoops).toBeGreaterThan(0);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    } finally { runtime.dispose(); }
}, 60000);
it('retains imported helper captures across repeated fixture runs', () => {
    const fixture = new URL('../../../demos/euler/450_hypocycloid_test.ra', import.meta.url);
    for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
        const results: { passed: boolean }[] = [];
        const runtime = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
            loadModule(specifier) {
                expect(specifier).toBe('450_hypocycloid');
                return { id: new URL('450_hypocycloid.ra', fixture).pathname, source };
            }, onTestResult: result => results.push(result) });
        try {
            runtime.execute(readFileSync(fixture, 'utf8'));
            expect(results.map(result => result.passed)).toEqual([true, true]);
        } finally { runtime.dispose(); }
    }
}, 60000);
