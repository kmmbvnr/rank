import { describe, expect, it } from 'vitest';
import { RankDeque, RankHeap, pushCollection } from '../src/containers.js';
import { addToCollection, newStructure } from '../src/collections.js';
import { type RankArray, type RankQueue } from '../src/value.js';
import { run } from './support.js';

const array = (items: RankArray['items'], shape = [items.length]): RankArray => ({ kind: 'array', items, shape });
const prelude = 'use algo\nuse sequences\n';

describe('mutable collection element contracts', () => {
    for (const kind of ['queue', 'stack', 'deque', 'heap', 'set', 'counter']) {
        const insert = (receiver: string, value: string) => kind === 'heap'
            ? `${receiver} 0 (${value}) enqueue` : `${receiver} ${['set', 'counter'].includes(kind) ? 'add' : 'push'} ${value}`;
        const remove = kind === 'set' || kind === 'counter' ? 'C remove array 1 2' : 'Old = C pop';

        it(`${kind}: aliases and calls share the contract after removal to empty`, () => {
            expect(() => run(prelude + `C = new ${kind}\n${insert('C', 'array 1 2')}\n${remove}
Alias = C
fun put Target
  ${insert('Target', 'array "bad"')}
end
Alias put
`)).toThrow(/array rank 1 of integer.*array rank 1 of text/);
        });

        it(`${kind}: lengths vary and empty arrays defer the cell contract`, () => {
            expect(run(prelude + `C = new ${kind}
${insert('C', 'array shape 0 fill 0')}
${insert('C', 'array 1 2')}
${insert('C', 'array 3 4 5')}
C len
`)).toBe('3');
            expect(() => run(prelude + `C = new ${kind}
${insert('C', 'array shape 0 fill 0')}
${insert('C', 'array 1 2')}
${insert('C', 'array 1.0 2.0')}
`)).toThrow(/of integer.*of real/);
        });

        it(`${kind}: loop insertions keep integer and real distinct`, () => {
            expect(() => run(prelude + `C = new ${kind}
for Value in array 1 2
  ${insert('C', 'Value')}
  ${insert('C', '2.0')}
end
`)).toThrow(`${kind} holds integer and cannot receive real`);
        });
    }

    it('a failed lazy insertion leaves the first successful type undecided', () => {
        const queue = new RankDeque();
        expect(() => queue.push({ kind: 'array', shape: [1], items: [], itemAt: () => { throw new Error('cell failed'); } }))
            .toThrow('cell failed');
        queue.push('text');
        expect(queue.items).toEqual(['text']);
    });

    it('rechecks a contract established by a lazy callback through an alias', () => {
        const queue = new RankDeque();
        const lazy: RankArray = { kind: 'array', shape: [1], items: [], itemAt: () => {
            queue.push('callback');
            return 1n;
        } };
        expect(() => queue.push(lazy)).toThrow(/holds text.*array/);
        expect(queue.items).toEqual(['callback']);
    });

    it('rejects nested array cell types and ranks, but allows different lengths', () => {
        const queue = new RankDeque().push(array([array([1n])]));
        queue.push(array([array([2n, 3n])]));
        expect(() => queue.push(array([array(['text'])]))).toThrow(/of integer.*of text/);
        expect(() => queue.push(array([array([1n], [1, 1])]))).toThrow(/rank 1.*rank 2/);
        expect(queue.size).toBe(2);
    });

    it('does not widen an array contract after a failed mixed-cell insertion', () => {
        const queue = new RankDeque().push(array([1n]));
        expect(() => queue.push(array([2n, 'bad']))).toThrow(/integer.*text/);
        expect(() => queue.push(array(['bad']))).toThrow(/integer.*text/);
        expect(queue.size).toBe(1);
    });

    it('checks all values of an externally supplied queue', () => {
        const queue: RankQueue = { kind: 'queue', items: [1n, 'text'] };
        expect(() => pushCollection(queue, 2n)).toThrow(/integer.*text/);
        expect(queue.items).toEqual([1n, 'text']);
        expect(queue.elementType).toBeUndefined();
    });

    it('failed keys and priorities do not fix the collection type', () => {
        for (const kind of ['set', 'counter']) {
            const collection = newStructure(kind);
            expect(() => addToCollection(collection, new RankDeque())).toThrow();
            expect(() => addToCollection(collection, 'text')).not.toThrow();
        }
        const heap = new RankHeap();
        expect(() => heap.push(1n, NaN)).toThrow('NaN');
        heap.push('text', 0n);
        expect(heap.pop()).toBe('text');
        expect(() => heap.push(1n, 0n)).toThrow(/holds text.*integer/);
    });

    it('array writes after insertion do not change stored cell types', () => {
        expect(run(prelude + `Q = new queue
A = array 1 2
Q push A
A 0 = 9
B = Q peek
B 0
`)).toBe('1');
    });

    it('index values remain heterogeneous', () => {
        expect(run(prelude + `I = new index
I "number" = 1
I "text" = "yes"
I "array" = array 1 2
I "number" = false
tuple (I "number") (I "text")
`)).toBe('false yes');
    });
});
