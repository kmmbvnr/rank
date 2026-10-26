import { describe, expect, it } from 'vitest';
import { arrayValues, ownedArray, readArrayItem } from '../src/array-storage.js';
import { framedArray } from '../src/framed-array.js';
import { materializeValue } from '../src/materialize.js';
import { mapScalarArrays } from '../src/scalar-array-map.js';
import { mapBroadcastArrays } from '../src/tensor.js';
import { isRankArray, type RankArray, type RankValue } from '../src/value.js';

const array = (value: RankValue): RankArray => {
    if (!isRankArray(value)) throw Error('expected array');
    return value;
};
const add = (a: RankValue, b: RankValue): RankValue => (a as bigint) + (b as bigint);
const maps = [
    { name: 'binary broadcast', map: (a: RankArray, b: RankArray) => mapBroadcastArrays(a, b, add) },
    { name: 'scalar callback', map: (a: RankArray, b: RankArray) => array(mapScalarArrays([a, b], ([x, y]) => add(x, y))) },
];

function rows(calls: number[], read = (i: number) => ownedArray([BigInt(i), BigInt(i + 10)])) {
    return framedArray([3], i => { calls.push(i); return read(i); }, {
        shape: [2], ownFiles() {}, mismatch: () => Error('changed cell shape'),
    });
}

describe.each(maps)('mapped traversal: $name', ({ map }) => {
    it('keeps one current producer cell through nested arithmetic, separately for each traversal', () => {
        const calls: number[] = [];
        const value = map(map(rows(calls), ownedArray([1n])), ownedArray([2n]));
        expect(calls).toEqual([]);
        for (let pass = 1; pass <= 2; pass++) {
            expect(array(materializeValue(value)).items).toEqual([3n, 13n, 4n, 14n, 5n, 15n]);
            expect(calls).toEqual(Array.from({ length: pass }, () => [0, 1, 2]).flat());
        }
        // A point read is a new observation, even at the same index.
        expect(readArrayItem(value, 0)).toBe(3n);
        expect(readArrayItem(value, 0)).toBe(3n);
        expect(calls.slice(-2)).toEqual([0, 0]);
    });

    it('keeps aliased operand cursors independent and reads operands left to right', () => {
        const calls: number[] = [];
        const source = rows(calls);
        const value = map(source, source);
        expect([...arrayValues(value)]).toEqual([0n, 20n, 2n, 22n, 4n, 24n]);
        expect(calls).toEqual([0, 0, 1, 1, 2, 2]);
    });

    it('does not demand later producer cells or retain a successful prefix after failure', () => {
        const calls: number[] = [];
        let fail = true;
        const source = rows(calls, i => {
            if (i === 1 && fail) throw Error('late producer failure');
            return ownedArray([BigInt(i), BigInt(i + 10)]);
        });
        const value = map(source, ownedArray([1n]));
        const prefix = arrayValues(value);
        expect(prefix.next().value).toBe(1n);
        expect(calls).toEqual([0]);
        prefix.return?.();
        expect(calls).toEqual([0]);
        expect(() => materializeValue(value)).toThrow('late producer failure');
        expect(calls).toEqual([0, 0, 1]);
        fail = false;
        expect(array(materializeValue(value)).items).toEqual([1n, 11n, 2n, 12n, 3n, 13n]);
        expect(calls).toEqual([0, 0, 1, 0, 1, 2]);
    });

    it('reports a changed result cell shape only when that cell is reached', () => {
        const calls: number[] = [];
        const value = map(rows(calls, i => ownedArray(i === 1 ? [1n] : [0n, 10n])), ownedArray([1n]));
        expect(calls).toEqual([]);
        const prefix = arrayValues(value);
        expect(prefix.next().value).toBe(1n);
        expect(prefix.next().value).toBe(11n);
        expect(() => prefix.next()).toThrow('changed cell shape');
        expect(calls).toEqual([0, 1]);
    });

    it('retains scalar host-read order around a producer cursor', () => {
        const events: string[] = [];
        const source = framedArray([2], i => {
            events.push(`cell ${i}`);
            return ownedArray([1n, 2n]);
        }, { shape: [2], ownFiles() {}, mismatch: () => Error('shape') });
        const host: RankArray = { kind: 'array', shape: [2, 2], items: [], itemAt(i) {
            events.push(`host ${i}`); return 10n;
        } };
        expect([...arrayValues(map(host, source))]).toEqual([11n, 12n, 11n, 12n]);
        expect(events).toEqual(['host 0', 'cell 0', 'host 1', 'host 2', 'cell 1', 'host 3']);
    });

    it('does not reuse an expanded producer across broadcast observations', () => {
        const calls: number[] = [];
        const source = framedArray([1], i => { calls.push(i); return ownedArray([1n, 2n]); }, {
            shape: [2], ownFiles() {}, mismatch: () => Error('shape'),
        });
        const value = map(source, ownedArray([10n, 20n, 30n], [3, 1]));
        expect([...arrayValues(value)]).toEqual([11n, 12n, 21n, 22n, 31n, 32n]);
        expect(calls).toEqual([0, 0, 0, 0, 0, 0]);
    });

    it('preserves the mapped scalar domain check', () => {
        const value = map(rows([]), ownedArray([1n]));
        // A fresh observation checks every output cell even with a prepared cursor.
        expect([...arrayValues(value)]).toEqual([1n, 11n, 2n, 12n, 3n, 13n]);
        const bad = array(mapScalarArrays([value], ([x]) => x === 12n ? 'bad' : x));
        expect(() => materializeValue(bad)).toThrow(/one element type/);
    });
});
