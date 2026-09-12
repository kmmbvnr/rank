import { describe, expect, it } from 'vitest';
import { arrayRevision, derivedArray, ownedArray, ownedObject } from '../src/array-storage.js';
import { projectField, projectFields } from '../src/modules/tables.js';

describe('whole-table revisions', () => {
    it('invalidates every dependent column after any field write', () => {
        const row = ownedObject([['x', 1n], ['y', 2n]]);
        const table = ownedArray([row]);
        const column = projectField(table, 'x');
        let reads = 0;
        const result = derivedArray([1], [column], i => { reads++; return column.itemAt!(i); });
        const first = arrayRevision(table);
        expect(first).toBeDefined();
        expect(result.items).toEqual([1n]);
        expect(result.itemAt!(0)).toBe(1n);
        expect(reads).toBe(1);
        row.entries.set('y', 3n);
        expect(reads).toBe(1);
        expect(arrayRevision(table)).not.toBe(first);
        expect(reads).toBe(1);
        expect(result.items).toEqual([1n]);
        expect(reads).toBe(2);
        row.entries.set('x', 9n);
        expect(result.items).toEqual([9n]);
        expect(reads).toBe(3);
    });

    it('observes row replacement, field deletion and a later insertion', () => {
        const first = ownedObject([['x', 1n], ['y', 2n]]);
        const second = ownedObject([['x', 3n], ['y', 4n]]);
        const table = ownedArray([first]);
        const matrix = projectFields(table, ownedArray(['x', 'y']));
        expect(matrix.items).toEqual([1n, 2n]);
        table.items[0] = second;
        expect(matrix.items).toEqual([3n, 4n]);
        second.entries.delete('x');
        expect(() => matrix.itemAt!(0)).toThrow('missing object key');
        second.entries.set('x', 5n);
        expect(matrix.items).toEqual([5n, 4n]);
    });

    it('does not retain a cache for untracked nested objects or cycles', () => {
        const table = ownedArray([{ kind: 'object', entries: new Map([['x', 1n]]) }]);
        expect(arrayRevision(table)).toBeUndefined();
        const cyclic = ownedArray([]);
        cyclic.items.push(cyclic);
        expect(arrayRevision(cyclic)).toBeUndefined();
    });
});
