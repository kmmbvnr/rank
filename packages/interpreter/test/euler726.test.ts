import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
import { isRankArray } from '../src/value.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/726_fallingbottles.ra', import.meta.url), 'utf8');
function execute(bottles: number, compilation: boolean, prime = 1000000033) {
    const host = new Interpreter(() => {}, { compilation }), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => host.execute(source.replace('arg Bottles integer = 10000', `Bottles = ${bottles}`)
            .replace('arg Prime integer = 1000000033', `Prime = ${prime}`)));
        const terms = host.variables.get('Terms');
        if (!terms || !isRankArray(terms)) throw Error('expected terms');
        return { answer: answerOf(host), terms: Array.from({ length: terms.shape[0] }, (_, i) => readArrayItem(terms, i)), diagnostics };
    } finally { host.dispose(); }
}

// Enumerate removals and each possible collapse, independently of the hook
// formula. State counts are invariant under bottle identities, but distinct
// collapse paths retain their multiplicity even when they reach the same mask.
function bottleWays(layers: number): bigint {
    const above: number[][] = [];
    for (let row = 0; row < layers; row++) for (let col = 0; col <= row; col++) {
        const start = row * (row - 1) / 2;
        above.push([...(col > 0 ? [start + col - 1] : []), ...(col < row ? [start + col] : [])]);
    }
    function collapse(mask: number, hole: number): number[] {
        const choices = above[hole].filter(at => mask & (1 << at));
        return choices.length ? choices.flatMap(at => collapse((mask | (1 << hole)) & ~(1 << at), at)) : [mask];
    }
    const memo = new Map<number, bigint>([[0, 1n]]);
    function remove(mask: number): bigint {
        const saved = memo.get(mask);
        if (saved !== undefined) return saved;
        let total = 0n;
        for (let at = 0; at < above.length; at++) if (mask & (1 << at)) {
            for (const next of collapse(mask & ~(1 << at), at)) total += remove(next);
        }
        memo.set(mask, total);
        return total;
    }
    return remove((1 << above.length) - 1);
}

describe('Euler 726 unchanged falling-bottle count', () => {
    it('keeps the three published bottle counts', () => {
        expect([1, 2, 3].map(bottleWays)).toEqual([1n, 6n, 1008n]);
        expect(execute(3, true).terms).toEqual([1n, 6n, 1008n]);
        expect(execute(3, true).answer).toBe(1015n);
    });
    it.each([101, 1000000033])('matches explicit collapse enumeration modulo %s', prime => {
        const expected = [1, 2, 3, 4, 5].map(bottleWays).map(n => n % BigInt(prime));
        const actual = execute(5, true, prime);
        expect(actual.terms).toEqual(expected);
        expect(actual.answer).toBe(expected.reduce((a, b) => a + b, 0n) % BigInt(prime));
        expect(actual.terms).toEqual(execute(5, false, prime).terms);
    });
    it.each([1, 2, 3, 4, 8, 16, 32, 100])('matches reference execution at %s layers', bottles => {
        const actual = execute(bottles, true), reference = execute(bottles, false);
        expect(actual.answer).toBe(reference.answer);
        expect(actual.terms).toEqual(reference.terms);
        expect(actual.diagnostics.modularCallbackScans).toBe(bottles === 1 ? 0 : 1);
        expect(reference.diagnostics.modularCallbackScans).toBe(0);
    });
});
