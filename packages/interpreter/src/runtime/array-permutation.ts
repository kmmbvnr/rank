import { arrayCells, arrayFrameAxes, derivedArray, registerArrayReadPlan } from './array-storage.js';
import { isKnownFileFree } from '../resource-summary.js';
import { inheritSemanticArrayType } from './semantic-array-type.js';
import { arrayOffset, coordinatesAt } from '../tensor-index.js';
import { isRankArray, type RankArray } from './value.js';
import { registerScalarView } from './integer-view.js';

/** A checked axis permutation preserves scalar addressing and producer cells. */
export function permutedArray(value: RankArray, permutation: readonly number[]): RankArray {
    const shape = permutation.map(axis => value.shape[axis]);
    const offsetAt = (index: number): number => {
        const output = coordinatesAt(shape, index);
        const sourceRank = value.shape.length;
        let source: number[];
        if (sourceRank === 2 && output.length === 2) {
            const first = output[0], second = output[1];
            source = output;
            source[0] = 0;
            source[1] = 0;
            source[permutation[0]] = first;
            source[permutation[1]] = second;
        } else {
            source = Array(sourceRank).fill(0) as number[];
            output.forEach((coordinate, axis) => { source[permutation[axis]] = coordinate; });
        }
        return source.reduce((current, coordinate, axis) => current * value.shape[axis] + coordinate, 0);
    };
    const result = registerScalarView(inheritSemanticArrayType(value, derivedArray(shape, [value], index => {
        const offset = offsetAt(index);
        return value.itemAt?.(offset) ?? value.items[offset];
    }, isKnownFileFree(value))), value, offsetAt, { regular: true });
    const cells = arrayCells(value);
    if (!cells) return result;
    const sourceFrames = arrayFrameAxes(cells);
    const sourceCellAxes = value.shape.map((_, axis) => axis).filter(axis => !sourceFrames.includes(axis));
    const frameAxes = permutation.map((axis, index) => sourceFrames.includes(axis) ? index : -1).filter(axis => axis >= 0);
    const frameOrder = frameAxes.map(axis => sourceFrames.indexOf(permutation[axis]));
    const frameShape = frameOrder.map(axis => cells.frameShape[axis]);
    const cellOrder = permutation.filter(axis => !sourceFrames.includes(axis)).map(axis => sourceCellAxes.indexOf(axis));
    return registerArrayReadPlan(result, { cells: {
        frameAxes, frameShape,
        cellShape: () => { const shape = cells.cellShape(); return shape && cellOrder.map(axis => shape[axis]); },
        read(index, observation) {
            const coordinates = coordinatesAt(frameShape, index);
            const original = Array(sourceFrames.length).fill(0) as number[];
            frameOrder.forEach((axis, position) => { original[axis] = coordinates[position]; });
            const cell = cells.read(arrayOffset(cells.frameShape, original), observation);
            return isRankArray(cell) && cellOrder.some((axis, position) => axis !== position)
                ? permutedArray(cell, cellOrder) : cell;
        },
    } });
}
