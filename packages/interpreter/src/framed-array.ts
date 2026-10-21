import type { KnownShape } from '@arrrank/language';
import { collectArrayValues, readArrayItem, registerArrayReadPlan } from './array-storage.js';
import { demandValue } from './plan.js';
import { MissingValueError } from './errors.js';
import { checkpoint } from './interrupt.js';
import { sameShape } from './tensor-index.js';
import { isRankArray, MISSING, type RankArray, type RankValue } from './value.js';

const sizeOf = (shape: readonly number[]): number => shape.reduce((size, n) => size * n, 1);

/** Stack result cells beneath a frame. Only shape evidence survives a read;
 * a prepared traversal owns at most its current result cell. */
export function framedArray(
    frameShape: readonly number[],
    cellAt: (index: number) => RankValue,
    options: {
        readonly shape?: KnownShape;
        readonly ownFiles: (value: RankValue) => void;
        readonly mismatch: (before: readonly number[], after: readonly number[], index: number) => Error;
        readonly prepare?: (shape: readonly number[]) => ((index: number) => RankValue) | undefined;
    },
): RankArray {
    let cellShape: readonly number[] | undefined = options.shape?.every(n => n !== null)
        ? [...options.shape] as number[] : undefined;
    const check = (value: RankValue, index: number): RankValue => {
        value = demandValue(value);
        const shape = isRankArray(value) ? value.shape : [];
        if (cellShape === undefined) cellShape = [...shape];
        else if (!sameShape(cellShape, shape)) throw options.mismatch(cellShape, shape, index);
        options.ownFiles(value);
        return value;
    };
    const readCell = (index: number): RankValue => check(cellAt(index), index);
    // A probe is local to the observation that needed the shape. Its value is
    // reused by that same items/itemAt call, never by a later observation.
    const probe = (): RankValue | undefined => cellShape === undefined ? readCell(0) : undefined;
    const shape = (): readonly number[] => [...frameShape, ...cellShape!];
    const at = (value: RankValue, offset: number): RankValue => isRankArray(value)
        ? readArrayItem(value, offset) : value;
    const prepare = (first?: RankValue): ((index: number) => RankValue) | undefined => {
        if (cellShape === undefined) return undefined;
        const width = sizeOf(cellShape);
        const fast = options.prepare?.(cellShape);
        let frame = first === undefined ? -1 : 0;
        let cell = first;
        return index => {
            const next = Math.floor(index / width);
            if (next !== frame) {
                cell = fast ? check(fast(next), next) : readCell(next);
                frame = next;
            }
            return at(cell!, index % width);
        };
    };
    const values = function* (first?: RankValue): IterableIterator<RankValue> {
        first ??= probe();
        if (sizeOf(cellShape!) === 0) {
            for (let frame = 0; frame < sizeOf(frameShape); frame++) {
                checkpoint('reading ranked result');
                if (frame !== 0 || first === undefined) readCell(frame);
            }
            return;
        }
        const read = prepare(first)!;
        const size = sizeOf(shape());
        for (let index = 0; index < size; index++) {
            checkpoint('reading ranked result');
            let item: RankValue;
            try { item = read(index); }
            catch (error) {
                if (!(error instanceof MissingValueError) || !error.soft) throw error;
                item = MISSING;
            }
            yield item;
        }
    };
    const result: RankArray = {
        kind: 'array',
        get shape() { probe(); return shape(); },
        itemAt(index) {
            const first = probe();
            const width = sizeOf(cellShape!);
            if (index < 0 || index >= sizeOf(shape())) throw new MissingValueError('rank result index out of bounds');
            const frame = Math.floor(index / width);
            return at(frame === 0 && first !== undefined ? first : readCell(frame), index % width);
        },
        get items() {
            const first = probe();
            return collectArrayValues(sizeOf(shape()), values(first));
        },
    };
    return registerArrayReadPlan(result, { prepare: () => prepare(), values: () => values(), collect: () => result.items });
}
