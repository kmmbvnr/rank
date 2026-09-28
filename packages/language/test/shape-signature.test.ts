import { describe, expect, it } from 'vitest';
import { instantiateShapeSignature as apply, validateShapeSignature as validate, type ShapeSignature } from '../src/shape-signature.js';

describe('shape signatures', () => {
    it('shares dimensions across arguments and checks square cells', () => {
        const square: ShapeSignature = { args: [['n', 'n']], result: ['n', 'n'] };
        expect(apply(square, [[3, 3]])).toEqual([3, 3]);
        expect(apply(square, [[null, 3]])).toEqual([3, 3]);
        expect(apply(square, [[2, 3]])).toBeUndefined();
        expect(apply(square, [[3]])).toBeUndefined();
        expect(apply(square, [undefined])).toEqual([null, null]);
    });
    it('concatenates dimensions and a shared shape tail', () => {
        const append: ShapeSignature = {
            args: [['m', { spread: 's' }], ['n', { spread: 's' }]],
            result: [{ add: ['m', 'n'] }, { spread: 's' }],
        };
        expect(validate(append)).toEqual([]);
        expect(apply(append, [[2, 3, 4], [5, 3, 4]])).toEqual([7, 3, 4]);
        expect(apply(append, [[2, null, 4], [5, 3, null]])).toEqual([7, 3, 4]);
        expect(apply(append, [[0], [5]])).toEqual([5]);
        expect(apply(append, [[2, 3], [5, 4]])).toBeUndefined();
        expect(apply(append, [[null, 3], [5, 3]])).toEqual([null, 3]);
    });
    it('supports fixed suffixes and natural-number sums in inputs', () => {
        expect(apply({ args: [[{ spread: 's' }, 'n']], result: ['n', { spread: 's' }] }, [[2, 3, 4]]))
            .toEqual([4, 2, 3]);
        const head: ShapeSignature = { args: [[{ add: [1, 'd'] }, { spread: 's' }]], result: [{ spread: 's' }] };
        expect(apply(head, [[3, 4]])).toEqual([4]);
        expect(apply(head, [[0, 4]])).toBeUndefined();
        expect(apply({ args: [[{ add: ['m', 'n'] }], ['m']], result: ['n'] }, [[5], [2]])).toEqual([3]);
        expect(apply({ args: [[{ add: ['n', 'n'] }]], result: ['n'] }, [[5]])).toBeUndefined();
    });
    it('does not guess existential dimensions or unknown shape tails', () => {
        expect(apply({ args: [['d']], result: [null] }, [[4]])).toEqual([null]);
        expect(apply({ args: [null], result: [] }, [undefined])).toEqual([]);
        expect(apply({ args: [[{ spread: 's' }]], result: [{ spread: 's' }] }, [undefined])).toBeUndefined();
        expect(apply({ args: [null, ['d']], result: null }, [[4], [2]])).toBeUndefined();
        expect(apply({ args: [[]], result: [] }, [])).toBeUndefined();
    });
    it('distinguishes unexpressed dimensions from value-dependent dimensions', () => {
        const uniform: ShapeSignature = { args: [['m', 'n']], result: [null] };
        const varying: ShapeSignature = { args: [['d']], result: [{ exists: 'k' }] };
        expect(validate(uniform)).toEqual([]);
        expect(validate(varying)).toEqual([]);
        expect(apply(uniform, [[2, 3]])).toEqual([null]);
        expect(apply(varying, [[3]])).toEqual([null]);
        expect(uniform.result).toEqual([null]);
        expect(varying.result).toEqual([{ exists: 'k' }]);
        expect(validate({ args: [[{ exists: 'k' }]], result: [] }))
            .toContain('existential dimension in an argument');
        expect(validate({ args: [['k']], result: [{ exists: 'k' }] }))
            .toContain('existential shadows input variable k');
    });

    it('rejects invalid catalogue contracts', () => {
        for (const signature of [
            { args: [['n']], result: ['m'] },
            { args: [['n', { spread: 'n' }]], result: [] },
            { args: [[{ spread: 'a' }, { spread: 'b' }]], result: [] },
            { args: [[-1]], result: [] },
            { args: [[]], result: [{ add: [] }] },
        ] satisfies ShapeSignature[]) expect(validate(signature).length).toBeGreaterThan(0);
    });
});
