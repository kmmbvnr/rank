import { framedArray } from './framed-array.js';
import { registerArrayDependencies } from './array-storage.js';
import { currentDiagnostics } from './diagnostics.js';
import { RankError } from './errors.js';
import { checkpoint, inspectionEnabled } from './interrupt.js';
import type { RankedMembership } from './membership-function.js';
import type { NativeFunction, RankArray, RankValue } from './value.js';

/** Assemble nonempty unary ranked cells without retaining demanded results. */
export function rankedCells(
    value: RankArray, fn: NativeFunction,
    cells: { frameShape: readonly number[]; cellShape: readonly number[]; cellAt(index: number): RankValue },
    scalar: ((arguments_: RankValue[]) => RankValue) | undefined,
    ownFiles: (value: RankValue) => void,
    arrayBatch: (() => (RankedMembership & { available(): boolean }) | undefined) | undefined,
): RankArray {
    const read = (index: number): RankValue => {
        const args = [cells.cellAt(index)];
        return scalar ? scalar(args) : fn.call(args);
    };
    const result = framedArray(cells.frameShape, read, {
        shape: fn.monadicResultShape?.(cells.cellShape), ownFiles,
        mismatch: (before, after, index) => new RankError(
            `rank results must have one shape: \`${fn.name ?? 'function'}\` gave ${before.join(' ') || 'a scalar'}`
            + ` and ${after.join(' ') || 'a scalar'} (cell ${index}); `
            + 'reduce inside a function you lift, or pad to a fixed width',
        ),
        prepare(shape) {
            if (inspectionEnabled()) return undefined;
            if (scalar && shape.length === 0) {
                const diagnostics = currentDiagnostics();
                if (diagnostics) diagnostics.rankedBatches++;
                return index => { checkpoint('ranked callback'); return scalar([cells.cellAt(index)]); };
            }
            if (shape.length !== 1) return undefined;
            const batch = arrayBatch?.();
            if (!batch || batch.width === 0 || batch.width !== shape[0]) return undefined;
            const diagnostics = currentDiagnostics();
            if (diagnostics) diagnostics.rankedArrayBatches++;
            return index => {
                if (!batch.available()) return read(index);
                const items = new Array<boolean>(batch.width);
                batch.fill(index, items);
                return { kind: 'array', shape: [batch.width], items, containsFiles: false };
            };
        },
    });
    return registerArrayDependencies(result, [value, fn]);
}
