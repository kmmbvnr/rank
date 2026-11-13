import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import type { RankArray } from '../src/value.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/324_tower.ra', import.meta.url), 'utf8');
const cells = (value: unknown) => [...(value as RankArray).items] as bigint[];
function configuration() {
    const runtime = new Interpreter(() => {}, { compilation: false });
    try {
        runtime.variables.set('Exp', 0n);
        runtime.execute(source);
        return { modulus: runtime.variables.get('Mod') as bigint, period: runtime.variables.get('Period') as bigint,
            initial: cells(runtime.variables.get('A0')), coefficients: cells(runtime.variables.get('C')) };
    } finally { runtime.dispose(); }
}
const { modulus, period, initial, coefficients } = configuration();
const k = coefficients.length;
const normalize = (value: bigint) => (value % modulus + modulus) % modulus;
// Generic monic polynomial division, independent of the demo's positive
// coefficient folds and native convolution. Read actual production constants.
const divisor = [...[...coefficients].reverse().map(value => normalize(-value)), 1n];
function product(a: bigint[], b: bigint[]): bigint[] {
    const out = Array<bigint>(a.length + b.length - 1).fill(0n);
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
    for (let i = out.length - 1; i >= k; i--) {
        const leading = normalize(out[i]);
        for (let j = 0; j <= k; j++) out[i - k + j] = normalize(out[i - k + j] - leading * divisor[j]);
    }
    return out.slice(0, k).map(normalize);
}
function power(n: bigint): bigint[] {
    let result = Array<bigint>(k).fill(0n), base = Array<bigint>(k).fill(0n);
    result[0] = 1n; base[1] = 1n;
    while (n > 0n) {
        if (n % 2n) result = product(result, base);
        base = product(base, base);
        n /= 2n;
    }
    return result;
}
function direct(n: bigint): bigint {
    return power(n).reduce((sum, value, i) => normalize(sum + value * initial[i]), 0n);
}

// Enumerate domino placements in a 3x3 slice; masks represent connections
// to the next slice. No recurrence coefficients or initial terms are used.
function towerCounts(maxHalfHeight: number): bigint[] {
    const transitions = Array.from({ length: 512 }, (_, incoming) => {
        const counts = new Map<number, bigint>();
        function fill(used: number, outgoing: number): void {
            if (used === 511) { counts.set(outgoing, (counts.get(outgoing) ?? 0n) + 1n); return; }
            let at = 0;
            while (used & (1 << at)) at++;
            fill(used | (1 << at), outgoing | (1 << at));
            for (const next of [at % 3 < 2 ? at + 1 : -1, at < 6 ? at + 3 : -1]) {
                if (next >= 0 && !(used & (1 << next))) fill(used | (1 << at) | (1 << next), outgoing);
            }
        }
        fill(incoming, 0);
        return [...counts];
    });
    let states = Array<bigint>(512).fill(0n);
    states[0] = 1n;
    const result = [1n];
    for (let height = 1; height <= 2 * maxHalfHeight; height++) {
        const next = Array<bigint>(512).fill(0n);
        for (let mask = 0; mask < 512; mask++) if (states[mask]) {
            for (const [to, count] of transitions[mask]) next[to] = normalize(next[to] + states[mask] * count);
        }
        states = next;
        if (height % 2 === 0) result.push(states[0]);
    }
    return result;
}
const towers = towerCounts(25);
const boundaries = [period - 1n, period, period + 1n, 2n * period + 29n, 2n ** 53n + 1n];
const boundaryValues = boundaries.map(direct);

it('certifies the actual period against the actual characteristic polynomial', () => {
    expect(period).toBeGreaterThan(0n);
    expect(initial).toHaveLength(k);
    const identity = Array<bigint>(k).fill(0n);
    identity[0] = 1n;
    expect(power(period)).toEqual(identity);
});

for (const mode of ['reference', 'compiled', 'exact'] as const) describe(`Euler 324 (${mode})`, () => {
    const options = { compilation: mode !== 'reference', numberLoopCompilation: mode !== 'exact' };
    function runtime() {
        const result = new Interpreter(() => {}, options);
        result.variables.set('Exp', 0n);
        result.execute(source);
        return result;
    }
    it('matches direct domino enumeration across the initial-term boundary', () => {
        const r = runtime();
        try {
            for (let n = 0; n < towers.length; n++) {
                r.variables.set('Index', BigInt(n));
                expect(r.execute('Index recurrence')).toBe(towers[n]);
            }
        } finally { r.dispose(); }
    });
    it('matches unreduced polynomial powering across period boundaries', () => {
        const r = runtime();
        try {
            for (let i = 0; i < boundaries.length; i++) {
                r.variables.set('Index', boundaries[i]);
                expect(r.execute('Index recurrence')).toBe(boundaryValues[i]);
            }
        } finally { r.dispose(); }
    });
    it('squares an aliased input without mutating it', () => {
        const r = runtime();
        const input = Array.from({ length: k }, (_, i) => BigInt(i * 7919));
        try {
            r.execute(`Left = array ${input.join(' ')}\nRight = Left\nResult = (Left combine Right) mod Mod`);
            expect(cells(r.variables.get('Result'))).toEqual(product(input, input));
            expect(cells(r.variables.get('Left'))).toEqual(input);
            expect(cells(r.variables.get('Right'))).toEqual(input);
        } finally { r.dispose(); }
    });
    it('retains the negative-index error before period reduction', () => {
        const r = runtime();
        try { expect(() => r.execute('(-1) recurrence')).toThrow(/out of bounds/); }
        finally { r.dispose(); }
    });
    it('retains the full 10000-digit default answer', () => {
        const r = new Interpreter(() => {}, options);
        try { r.execute(source); expect(answerOf(r)).toBe(96972774n); }
        finally { r.dispose(); }
    });
});
