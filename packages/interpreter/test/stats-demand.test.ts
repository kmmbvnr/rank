import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { arrayValues, derivedArray, ownedArray, readArrayItem } from '../src/array-storage.js';
import { materializeValue } from '../src/materialize.js';
import { covarianceValue } from '../src/modules/stats.js';
import type { RankArray } from '../src/value.js';

describe('covariance observation state', () => {
    it('recomputes means for each independent cell observation', () => {
        let scale = 1, reads = 0;
        const source = derivedArray([2, 3], [ownedArray([0n])], index => {
            reads++;
            return (index + 1) * scale;
        }, true);
        const covariance = covarianceValue(source);
        expect(reads).toBe(0);
        expect(readArrayItem(covariance, 0)).toBe(1);
        expect(reads).toBe(9);
        scale = 2;
        expect(readArrayItem(covariance, 0)).toBe(4);
        expect(reads).toBe(18);
    });

    it('shares feature means only within the current batch of one traversal', () => {
        let reads = 0;
        const source = derivedArray([2, 2, 3], [], index => {
            reads++;
            return (index % 6 + 1) * (index < 6 ? 1 : 2);
        }, true);
        const covariance = covarianceValue(source);
        expect([...arrayValues(covariance)]).toEqual([1, 1, 1, 1, 4, 4, 4, 4]);
        expect(reads).toBe(60);
        expect([...arrayValues(covariance)]).toEqual([1, 1, 1, 1, 4, 4, 4, 4]);
        expect(reads).toBe(120);
        const saved = materializeValue(covariance) as RankArray;
        expect(reads).toBe(180);
        expect([...arrayValues(saved)]).toEqual([1, 1, 1, 1, 4, 4, 4, 4]);
        expect(reads).toBe(180);
    });

    it('discards means from abandoned and failed traversals', () => {
        let reads = 0, fail = false;
        const source = derivedArray([2, 3], [], index => {
            reads++;
            if (fail && reads === 5) throw Error('source failed');
            return index + 1;
        }, true);
        const covariance = covarianceValue(source);
        const prefix = arrayValues(covariance);
        expect(prefix.next().value).toBe(1);
        prefix.return?.();
        expect(reads).toBe(9);
        expect([...arrayValues(covariance)]).toEqual([1, 1, 1, 1]);
        expect(reads).toBe(39);
        reads = 0;
        fail = true;
        expect(() => [...arrayValues(covariance)]).toThrow('source failed');
        expect(reads).toBe(5);
        reads = 0;
        fail = false;
        expect([...arrayValues(covariance)]).toEqual([1, 1, 1, 1]);
        expect(reads).toBe(30);
    });

    it('retains covariance traversal state inside a ranked frame', () => {
        const runtime = new Interpreter();
        let reads = 0;
        runtime.variables.set('Data', derivedArray([2, 2, 3], [], index => {
            reads++;
            return (index % 6 + 1) * (index < 6 ? 1 : 2);
        }, true));
        try {
            const value = runtime.execute('use stats\nData covariance rank 2') as RankArray;
            expect([...arrayValues(value)]).toEqual([1, 1, 1, 1, 4, 4, 4, 4]);
            expect(reads).toBe(60);
            expect([...arrayValues(value)]).toEqual([1, 1, 1, 1, 4, 4, 4, 4]);
            expect(reads).toBe(120);
            const prefix = arrayValues(value);
            expect(prefix.next().value).toBe(1);
            prefix.return?.();
            expect(reads).toBe(129);
            expect([...arrayValues(value)]).toEqual([1, 1, 1, 1, 4, 4, 4, 4]);
            expect(reads).toBe(189);
        } finally { runtime.dispose(); }
    });

    it('does not read source cells for an empty feature frame', () => {
        const source = derivedArray([0, 3], [], () => { throw Error('unexpected cell'); }, true);
        expect([...arrayValues(covarianceValue(source))]).toEqual([]);
    });
});
