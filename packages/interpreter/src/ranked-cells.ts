import { demandValue } from './plan.js';
import { arrayRevision, readArrayItem, registerArrayDependencies, registerArrayReadPlan } from './array-storage.js';
import { currentDiagnostics } from './diagnostics.js';
import { RankError } from './errors.js';
import { checkpoint, inspectionEnabled } from './interrupt.js';
import type { RankedMembership } from './membership-function.js';
import { sameShape } from './tensor-index.js';
import { isRankArray, type NativeFunction, type RankArray, type RankValue } from './value.js';

const arrayItem = readArrayItem;
const arraySize = (shape: readonly number[]): number => shape.reduce((size, n) => size * n, 1);

/** Assemble nonempty ranked cells, retaining dependency and result-shape checks. */
export function rankedCells(
    value: RankArray, fn: NativeFunction,
    cells: { frameShape: readonly number[]; cellAt(index: number): RankValue },
    builtin: boolean,
    scalar: ((arguments_: RankValue[]) => RankValue) | undefined,
    ownFiles: (value: RankValue) => void,
    arrayBatch: (() => (RankedMembership & { available(): boolean }) | undefined) | undefined,
): RankArray {
    const results = new Map<number, RankValue>();
    let inputRevision: number | undefined;
    let materialized: RankValue[] | undefined;
    const refresh = () => {
        if (!builtin) return true;
        const current = arrayRevision(value);
        if (current === undefined || current !== inputRevision) {
            results.clear();
            materialized = undefined;
            if (current !== inputRevision) resultCellShape = undefined;
            inputRevision = current;
        }
        return current !== undefined;
    };
    let resultCellShape: readonly number[] | undefined;
    const retainResult = (result: RankValue, frameIndex: number, cacheable: boolean): RankValue => {
        result = demandValue(result);
        const shape = isRankArray(result) ? result.shape : [];
        if (resultCellShape === undefined) {
            resultCellShape = [...shape];
        } else if (!sameShape(resultCellShape, shape)) {
            throw new RankError(
                `rank results must have one shape: \`${fn.name ?? 'function'}\` gave ${resultCellShape.join(' ') || 'a scalar'}`
                + ` and ${shape.join(' ') || 'a scalar'} (cell ${frameIndex}); `
                + 'reduce inside a function you lift, or pad to a fixed width',
            );
        }
        ownFiles(result);
        if (cacheable) results.set(frameIndex, result);
        return result;
    };
    const resultAt = (frameIndex: number): RankValue => {
        const cacheable = refresh();
        const cached = results.get(frameIndex);
        if (cached !== undefined) return cached;
        const arguments_ = [cells.cellAt(frameIndex)];
        return retainResult(scalar ? scalar(arguments_) : fn.call(arguments_), frameIndex, cacheable);
    };
    const outputShape = (): readonly number[] => {
        resultAt(0);
        return [...cells.frameShape, ...resultCellShape!];
    };

    const prepareScalarRead = (): ((index: number) => RankValue) | undefined => {
        if (!scalar || inspectionEnabled() || resultCellShape?.length !== 0) return undefined;
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.rankedBatches++;
        return index => {
            checkpoint('ranked callback');
            let cell = results.get(index);
            if (cell === undefined) cell = retainResult(scalar([cells.cellAt(index)]), index, true);
            return isRankArray(cell) ? arrayItem(cell, 0) : cell;
        };
    };

    const prepareArrayRead = (): ((index: number) => RankValue) | undefined => {
        if (inspectionEnabled() || resultCellShape?.length !== 1) return undefined;
        const batch = arrayBatch?.();
        if (!batch || batch.width === 0 || batch.width !== resultCellShape[0]) return undefined;
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.rankedArrayBatches++;
        return index => {
            const frame = Math.floor(index / batch.width);
            let cell = results.get(frame);
            if (cell === undefined) {
                if (!batch.available()) return result.itemAt!(index);
                const items = new Array<boolean>(batch.width);
                batch.fill(frame, items);
                // This private boolean row is only exposed through scalar
                // reads of the framed result; it needs no writable storage.
                cell = retainResult({ kind: 'array', shape: [batch.width], items, containsFiles: false }, frame, true);
            }
            return isRankArray(cell) ? arrayItem(cell, index % batch.width) : cell;
        };
    };
    const prepareRead = () => prepareScalarRead() ?? prepareArrayRead();
    const result: RankArray = {
        kind: 'array',
        get shape() {
            return outputShape();
        },
        itemAt(index) {
            outputShape();
            const cellSize = arraySize(resultCellShape!);
            const frameIndex = Math.floor(index / cellSize);
            const result = resultAt(frameIndex);
            return isRankArray(result) ? arrayItem(result, index % cellSize) : result;
        },
        get items() {
            const shape = outputShape();
            if (!materialized) {
                const read = prepareRead();
                if (read) {
                    const values: RankValue[] = new Array(arraySize(shape));
                    for (let index = 0; index < values.length; index++) values[index] = read(index);
                    materialized = values;
                } else materialized = Array.from(
                    { length: arraySize(shape) }, (_, index) => this.itemAt!(index));
            }
            return materialized;
        },
    };
    registerArrayReadPlan(result, prepareRead);
    return builtin ? registerArrayDependencies(result, [value]) : result;
}
