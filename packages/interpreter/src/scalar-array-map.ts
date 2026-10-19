import { derivedArray, evaluateArrayItem } from './array-storage.js';
import { completed, mapExecution, mapResult, runExecution } from './execution.js';
import { arrayStrides, broadcastOffset, broadcastShape } from './tensor-layout.js';
import { isRankArray, type RankValue } from './value.js';

/** Map a checked scalar body over any finite array operands. Other values
 * remain scalar inputs, so sequences are never implicitly materialized. */
export function mapScalarArrays(args: RankValue[], operation: (cells: RankValue[]) => RankValue): RankValue {
    if (!args.some(isRankArray)) return operation(args);
    const arrays = args.filter(isRankArray);
    const shape = arrays.reduce<readonly number[]>((shape, array) => broadcastShape(shape, array.shape), []);
    const readers = args.map(value => {
        if (!isRankArray(value)) return (_: number) => completed(value);
        const same = value.shape.length === shape.length && value.shape.every((n, i) => n === shape[i]);
        const strides = arrayStrides(value.shape);
        return (index: number) => evaluateArrayItem(value,
            same ? index : broadcastOffset(index, shape, value.shape, strides));
    });
    const evaluate = (index: number) => mapResult(mapExecution(readers, read => read(index)), operation);
    return derivedArray(shape, arrays, index => runExecution(evaluate(index)), true, evaluate);
}
