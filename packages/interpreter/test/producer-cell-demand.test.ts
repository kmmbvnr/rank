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
import { mapScalarArrays } from '../src/scalar-array-map.js';
import { transposeValue } from '../src/modules/sequences.js';

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

    it('preserves ranked gather frames and repeated empty producer observations', () => {
        const { rows, calls } = emptyRows();
        const indices = ownedArray([1n, 0n, 1n, 1n], [2, 2]);
        const selected = sliceArray(rows, tensorSelection(rows, [indices, 2n, ALL_AXIS]));
        expect(calls).toEqual([]);
        expect(array(materializeValue(selected)).shape).toEqual([2, 2, 0]);
        expect(calls).toEqual([6n, 3n, 6n, 6n]);
        materializeValue(selected);
        expect(calls).toEqual([6n, 3n, 6n, 6n, 6n, 3n, 6n, 6n]);
    });

    it('preserves expanded selector axes around permuted empty producer cells', () => {
        const { rows, calls } = emptyRows();
        const transposed = array(transposeValue(rows, [2, 1, 0]));
        const indices = ownedArray([1n, 0n], [1, 2]);
        const selected = sliceArray(transposed, tensorSelection(transposed, [ALL_AXIS, 2n, indices]));
        expect(calls).toEqual([]);
        expect(array(materializeValue(selected)).shape).toEqual([0, 1, 2]);
        expect(calls).toEqual([6n, 3n]);
    });

    it('expands both cell and frame selectors after a producer transpose', () => {
        const calls: bigint[] = [];
        const fn = { ...native('row', 1, ([value]) => {
            calls.push(value as bigint);
            const n = value as bigint;
            return ownedArray([n, n + 1n, n + 2n]);
        }), monadicResultShape: () => [3] };
        const app = new RankApplication((f, args) => completed(f.call(args)), () => {}, new Map(), () => undefined);
        const rows = array(runExecution(app.applyUnaryAtRank(ownedArray([10n, 40n]), fn, 0)));
        const transposed = array(transposeValue(rows));
        const selected = sliceArray(transposed, tensorSelection(transposed, [
            ownedArray([2n, 0n], [1, 2]), ownedArray([1n, 0n], [2, 1]),
        ]));
        expect(calls).toEqual([]);
        const result = array(materializeValue(selected));
        expect(result.shape).toEqual([1, 2, 2, 1]);
        expect(result.items).toEqual([42n, 12n, 40n, 10n]);
        // Transpose observes each selected column in output order.
        expect(calls).toEqual([40n, 10n, 40n, 10n]);
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
        const checked = contract.check(array(transposeValue(rows)));
        expect(calls).toEqual([]);
        expect(array(materializeValue(sliceArray(checked, tensorSelection(checked, [ALL_AXIS, 0n])))).items).toEqual([1n, 2n]);
        expect(() => materializeValue(sliceArray(checked, tensorSelection(checked, [ALL_AXIS, 1n])))).toThrow(/array elements/);
        expect(calls).toEqual([1n, 2n]);
    });

    it.each([false, true])('retains captured files through a deferred selected view without evaluating cells (mapped transpose=%s)', mapped => {
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
                if (mapped) {
                    const view = array(transposeValue(mapScalarArrays([rows], () => 1n)));
                    return sliceArray(view, tensorSelection(view, [ALL_AXIS, ownedArray([1n])]));
                }
                return sliceArray(rows, tensorSelection(rows, [ownedArray([1n]), ALL_AXIS]));
            });
            expect(calls).toBe(0);
            expect(file.closed).toBe(false);
            expect(array(materializeValue(selected!)).items).toEqual(mapped ? [1n] : [file]);
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

describe.each([false, true])('reducing empty producer cells (compilation=%s)', compilation => {
    it.each([
        ['Rows reduce + rank 1 with 0', [2]], ['Rows reduce + with 0', null],
        ['Rows reduce max with 0', null],
        ['Rows sum axis 1', [2]], ['Rows sum rank 1', [2]],
        ['Rows (array 0) outer width', [2, 1]],
    ] as const)('%s executes its selected producers', (expression, shape) => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), { compilation });
        try {
            runtime.execute(`use io
fun A width B rank 1 0 = A len + B
fun X empty
 X print
 return array shape 0 fill 0
end
Rows' = (array 1 2) empty rank 0`);
            expect(output).toEqual([]);
            runtime.execute(`Saved = ${expression}`);
            expect(output).toEqual(['1', '2']);
            const saved = runtime.variables.get('Saved')!;
            if (shape) expect(array(saved).shape).toEqual(shape);
            else expect(saved).toBe(0n);
            expect(runtime.execute('Saved sum')).toBe(0n);
        } finally { runtime.dispose(); }
    });

    it.each(['Rows max axis 1', 'Rows mean axis 1', 'Rows reduce - rank 1'])('%s stops at the first invalid empty cell after producing it', expression => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), { compilation });
        try {
            runtime.execute(`use io
use stats
fun X empty
 X print
 return array shape 0 fill 0
end
Rows' = (array 1 2) empty rank 0`);
            expect(() => runtime.execute(`Saved = ${expression}`)).toThrow(/empty|at least one/);
            expect(output).toEqual(['1']);
            expect(runtime.variables.has('Saved')).toBe(false);
        } finally { runtime.dispose(); }
    });
});
