import { describe, expect, it, vi } from 'vitest';
import { Interpreter, isRankArray, type RankArray, type RankValue } from '../src/index.js';
import { native } from '../src/modules/shared.js';
import { compileTensorCellCopy } from '../src/tensor-cell-compiler.js';

type Mutation = (source: RankArray, cells: RankArray[], reads: number) => void;
function observe(compiled: boolean, mutate: Mutation, onRead: Mutation = () => {}) {
    const cells: RankArray[] = [], snapshots: unknown[] = [], reads: number[] = [];
    const storage: RankValue[] = [1n, 2n, 3n, 4n, 5n, 6n];
    const source: RankArray = { kind: 'array', shape: [2, 3], get items() {
        reads.push(reads.length);
        onRead(source, cells, reads.length);
        return storage;
    } };
    const runtime = new Interpreter(undefined, { tensorCellCompilation: compiled });
    runtime.variables.set('A', source);
    runtime.variables.set('observe', native('observe', 1, ([value]) => {
        if (!isRankArray(value)) throw new Error('expected cell');
        cells.push(value);
        snapshots.push({ shape: [...value.shape], items: [...value.items] });
        mutate(source, cells, reads.length);
        return 0n;
    }));
    let error: string | undefined;
    try { runtime.execute('for Cell in A\n  Cell observe\nend'); }
    catch (e) { error = String(e); }
    finally { runtime.dispose(); }
    return { snapshots, reads, error, retained: cells.map(cell => [...cell.items]) };
}

describe('compiled tensor cell copying', () => {
    it.each<Mutation>([
        () => {},
        (source, cells) => { if (cells.length === 1) (source.shape as number[]).push(1); },
        (_, cells) => { if (cells.length === 1) (cells[0].shape as number[]).push(1); },
        (_, cells) => { if (cells.length === 1) (cells[0].shape as number[])[0] = 2; },
        (_, cells) => { if (cells.length === 1) cells[0].items[0] = 99n; },
    ])('preserves host mutation and independent cell contents', mutate => {
        expect(observe(true, mutate)).toEqual(observe(false, mutate));
    });

    it.each<Mutation>([
        (source, _, reads) => { if (reads === 2) (source.shape as number[])[1] = 2; },
        (_, cells, reads) => { if (reads === 4) (cells[0].shape as number[]).push(1); },
        (_, __, reads) => { if (reads === 4) throw new Error('read failure'); },
    ])('preserves getter order, shape changes during copying and errors', onRead => {
        expect(observe(true, () => {}, onRead)).toEqual(observe(false, () => {}, onRead));
    });

    it('declines a changed coordinate rank before touching storage', () => {
        const copy = compileTensorCellCopy(2, [1])!;
        let reads = 0;
        const source: RankArray = { kind: 'array', shape: [1, 1, 1], get items() { reads++; return [1n]; } };
        expect(copy(source, [0, 0, 0], [1])).toBeUndefined();
        expect(reads).toBe(0);
    });

    it('keeps scalar and mixed cells unchanged', () => {
        const items: RankValue[] = [1n, 'text', true, { kind: 'label', name: 'sample' }];
        const source: RankArray = { kind: 'array', items, shape: [2, 2] };
        expect(compileTensorCellCopy(2, [])!(source, [1, 1], [])).toEqual([items[3]]);
        expect(compileTensorCellCopy(2, [1])!(source, [0, 0], [2])).toEqual(items.slice(0, 2));
    });

    it('falls back for excessive rank and unavailable code generation', () => {
        expect(compileTensorCellCopy(17, [])).toBeUndefined();
        const spy = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw new Error('CSP'); });
        try { expect(compileTensorCellCopy(15, [4, 7])).toBeUndefined(); }
        finally { spy.mockRestore(); }
        expect(compileTensorCellCopy(15, [4, 7])).toBeTypeOf('function');
    });
});
