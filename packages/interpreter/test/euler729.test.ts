import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
import { isRankArray } from '../src/value.js';

const source = readFileSync(new URL('../../../demos/euler/729_periodicrange.ra', import.meta.url), 'utf8');
function execute(period: number, compilation = true) {
    const host = new Interpreter(() => {}, { compilation });
    try {
        host.execute(source.replace('arg Period integer = 25', `Period = ${period}`));
        const cells = (name: string) => {
            const value = host.variables.get(name);
            if (!value || !isRankArray(value)) throw Error(`missing ${name}`);
            return Array.from({ length: value.shape[0] }, (_, i) => readArrayItem(value, i));
        };
        return { answer: host.variables.get('Answer'), words: cells('Lyndon'), lengths: cells('Lengths') };
    } finally { host.dispose(); }
}
function primitive(word: string) {
    for (let size = 1; size < word.length; size++) {
        if (word.length % size === 0 && word.slice(0, size).repeat(word.length / size) === word) return false;
    }
    return true;
}
const inverse = (point: number, bit: string) => (point + (bit === '1' ? 1 : -1) * Math.sqrt(point * point + 4)) / 2;

// Enumerate all primitive words, including every rotation. Find each inverse
// composition's fixed point by bisection, independently of Lyndon generation
// and the demo's Newton updates. Each word contributes one orbit range.
function oracle(period: number) {
    let total = 0;
    const lyndon: { word: bigint; length: bigint }[] = [];
    for (let length = 2; length <= period; length++) for (let code = 0; code < 2 ** length; code++) {
        const word = code.toString(2).padStart(length, '0');
        if (!primitive(word)) continue;
        const compose = (start: number) => [...word].reduce(inverse, start);
        let low = -2 * length, high = 2 * length;
        for (let iteration = 0; iteration < 80; iteration++) {
            const mid = (low + high) / 2;
            if (compose(mid) > mid) low = mid; else high = mid;
        }
        let point = (low + high) / 2, min = point, max = point;
        for (const bit of word) { point = inverse(point, bit); min = Math.min(min, point); max = Math.max(max, point); }
        total += max - min;
        if (Array.from({ length }, (_, shift) => word.slice(shift) + word.slice(0, shift)).every(rotation => word <= rotation)) {
            lyndon.push({ word: BigInt(code), length: BigInt(length) });
        }
    }
    return { answer: total.toFixed(4), lyndon };
}

describe('Euler 729 unchanged periodic inverse orbits', () => {
    it.each([2, 3, 4, 5, 6, 7, 8])('matches independent bisection and primitive-word enumeration through period %s', period => {
        const actual = execute(period), expected = oracle(period);
        expect(actual.answer).toBe(expected.answer);
        const pairs = actual.words.map((word, i) => ({ word, length: actual.lengths[i] }));
        expect(pairs.sort((a, b) => Number(a.length) - Number(b.length) || Number(a.word) - Number(b.word))).toEqual(expected.lyndon);
        expect(actual).toEqual(execute(period, false));
    });
    it.each([[2, '2.8284'], [3, '14.6461'], [5, '124.1056']] as const)('keeps the published S(%s) example', (period, answer) => {
        expect(execute(period).answer).toBe(answer);
    });
    it.each([14, 16])('keeps compiled/reference output after choose enters its dense path at period %s', period => {
        expect(execute(period)).toEqual(execute(period, false));
    });
});
