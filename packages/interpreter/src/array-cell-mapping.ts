import { arrayCells, arrayFrameAxes, registerArrayReadPlan } from './array-storage.js';
import { ALL_AXIS, sliceArray, tensorSelection } from './selectors.js';
import { coordinatesAt } from './tensor-index.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

/** Lift producer-cell geometry through a shape-preserving broadcast map.
 * A cell read selects its operand cells before applying the scalar mapping;
 * zero scalar width therefore cannot erase those producer observations. */
export function mapArrayCells(
    result: RankArray, arguments_: readonly RankValue[],
    mapCells: (values: RankValue[]) => RankValue,
): RankArray {
    const operands = arguments_.map(value => ({ value }));
    const arrays = arguments_.filter(isRankArray);
    const frames = new Set<number>();
    let hasCells = false;
    for (const array of arrays) {
        const cells = arrayCells(array);
        if (!cells) continue;
        hasCells = true;
        const leading = result.shape.length - array.shape.length;
        for (const axis of arrayFrameAxes(cells)) frames.add(leading + axis);
    }
    if (!hasCells) return result;
    const frameAxes = [...frames].sort((a, b) => a - b);
    const frameShape = frameAxes.map(axis => result.shape[axis]);
    const cellShape = result.shape.filter((_, axis) => !frames.has(axis));
    return registerArrayReadPlan(result, { cells: {
        frameAxes, frameShape, cellShape: () => cellShape,
        read(index, observation) {
            const coordinates = coordinatesAt(frameShape, index);
            const selected = operands.map(operand => {
                const value = operand.value;
                if (!isRankArray(value)) return value;
                const leading = result.shape.length - value.shape.length;
                const selectors = value.shape.map((size, axis) => {
                    const frame = frameAxes.indexOf(leading + axis);
                    return frame < 0 ? ALL_AXIS : BigInt(size === 1 ? 0 : coordinates[frame]);
                });
                return sliceArray(value, tensorSelection(value, selectors), observation?.branch(operand));
            });
            return mapCells(selected);
        },
    } });
}
