import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, type RankArray, type RankFile, type RankValue } from '../src/index.js';
import { ArrayBindingContract } from '../src/array-binding-contract.js';
import { ownedArray } from '../src/array-storage.js';
import { completed, runExecution } from '../src/execution.js';
import { materializeValue } from '../src/materialize.js';
import { native } from '../src/modules/shared.js';
import { RankApplication, tensorCells } from '../src/rank-application.js';
import { ALL_AXIS, atArray, sliceArray, tensorSelection } from '../src/selectors.js';
import { sliceSource } from '../src/slice-source.js';
import { ResourceOwnership } from '../src/resource-ownership.js';
import { MemoryIo } from './support.js';

const array = (value: RankValue): RankArray => {
    if (!isRankArray(value)) throw Error('expected array');
    return value;
};

function emptyRows() {
    const calls: bigint[] = [];
    const fn = { ...native('empty', 1, ([value]) => {
        calls.push(value as bigint);
        return ownedArray([], [0]);
    }), monadicResultShape: () => [0] };
    const app = new RankApplication((f, args) => completed(f.call(args)), () => {}, new Map(), () => undefined);
    const rows = array(runExecution(app.applyUnaryAtRank(ownedArray([1n, 2n, 3n, 4n, 5n, 6n], [2, 3]), fn, 0)));
    return { rows, calls };
}

describe('producer cell selection', () => {
    it('demands only the selected empty row and repeats its effects', () => {
        const { rows, calls } = emptyRows();
        const row = atArray(rows, [1n]);
        expect(calls).toEqual([]);
        expect(array(materializeValue(row)).shape).toEqual([3, 0]);
        expect(calls).toEqual([4n, 5n, 6n]);
        materializeValue(row);
        expect(calls).toEqual([4n, 5n, 6n, 4n, 5n, 6n]);
    });

    it('keeps nested indexing and tensor frame selection attached to producers', () => {
        const { rows, calls } = emptyRows();
        materializeValue(atArray(array(atArray(rows, [1n])), [2n]));
        expect(calls).toEqual([6n]);
        const columns = tensorCells(rows, [1]);
        materializeValue(columns.cellAt(1));
        expect(calls).toEqual([6n, 2n, 5n]);
    });

    it('keeps gather order and duplicate producer observations', () => {
        const { rows, calls } = emptyRows();
        const selected = sliceArray(rows, tensorSelection(rows, [ownedArray([1n, 0n, 1n]), 2n, ALL_AXIS]));
        expect(calls).toEqual([]);
        expect(array(materializeValue(selected)).shape).toEqual([3, 0]);
        expect(calls).toEqual([6n, 3n, 6n]);
    });

    it('preserves empty cells through take/drop and does not demand take zero', () => {
        const { rows, calls } = emptyRows();
        materializeValue(sliceSource(rows)!.slice(0n, false));
        expect(calls).toEqual([]);
        materializeValue(sliceSource(rows)!.slice(1n, true));
        expect(calls).toEqual([4n, 5n, 6n]);
    });

    it('keeps one root element contract across selected producer cells', () => {
        const calls: bigint[] = [];
        const fn = { ...native('row', 1, ([value]) => {
            calls.push(value as bigint);
            return ownedArray(value === 1n ? [1n, 2n] : ['wrong', 'type']);
        }), monadicResultShape: () => [2] };
        const app = new RankApplication((f, args) => completed(f.call(args)), () => {}, new Map(), () => undefined);
        const rows = array(runExecution(app.applyUnaryAtRank(ownedArray([1n, 2n]), fn, 0)));
        const contract = new ArrayBindingContract('Rows');
        const checked = contract.check(rows);
        expect(calls).toEqual([]);
        expect(array(materializeValue(atArray(checked, [0n]))).items).toEqual([1n, 2n]);
        expect(() => materializeValue(atArray(checked, [1n]))).toThrow(/array elements/);
        expect(calls).toEqual([1n, 2n]);
    });

    it('retains captured files through a deferred selected view without evaluating cells', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const file: RankFile = { kind: 'file', handle: io.open('/input', 'read'), closed: false };
        const ownership = new ResourceOwnership();
        let calls = 0;
        try {
            const selected = ownership.withResourceScope(() => {
                ownership.ownFile(file);
                const fn = { ...native('file', 1, () => { calls++; return ownedArray([file]); }),
                    captureValues: () => [file], monadicResultShape: () => [1] };
                const app = new RankApplication((f, args) => completed(f.call(args)),
                    value => ownership.ownFiles(value), new Map(), () => undefined);
                const rows = array(runExecution(app.applyUnaryAtRank(ownedArray([1n, 2n]), fn, 0)));
                return sliceArray(rows, tensorSelection(rows, [ownedArray([1n]), ALL_AXIS]));
            });
            expect(calls).toBe(0);
            expect(file.closed).toBe(false);
            expect(array(materializeValue(selected!)).items).toEqual([file]);
            expect(calls).toBe(1);
        } finally { ownership.dispose(); }
        expect(file.closed).toBe(true);
    });
});

it.each([false, true])('checks the shape of a selected producer with an empty first result (compilation=%s)', compilation => {
    const runtime = new Interpreter(undefined, { compilation });
    try {
        runtime.execute(`fun X varying
 if X equal 1
  return array shape 0 fill 0
 end
 return array 2
end
Rows' = (array 1 2) varying rank 0`);
        expect(() => runtime.execute('Saved = Rows 1')).toThrow(/shape/);
        expect(runtime.variables.has('Saved')).toBe(false);
    } finally { runtime.dispose(); }
});

it.each([false, true])('does not evaluate later scalar cells before an early loop break (compilation=%s)', compilation => {
    const output: string[] = [];
    const runtime = new Interpreter(line => output.push(line), { compilation });
    try {
        runtime.execute(`use io
fun X observed
 X print
 return X
end
Values' = (array 1 2 3) observed rank 0
for X in Values
 break
end`);
        expect(output).toEqual(['1']);
    } finally { runtime.dispose(); }
});

it.each([false, true])('demands a selected empty ranked loop cell before breaking (compilation=%s)', compilation => {
    const output: string[] = [];
    const runtime = new Interpreter(line => output.push(line), { compilation });
    try {
        runtime.execute(`use io
fun X empty
 X print
 return array shape 0 fill 0
end
Rows' = (array 1 2 3) empty rank 0
for Row in Rows rank 1
 break
end`);
        expect(output).toEqual(['1']);
    } finally { runtime.dispose(); }
});
