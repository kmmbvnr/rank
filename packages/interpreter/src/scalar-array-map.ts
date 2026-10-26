import { derivedArray, evaluateArrayItem, prepareArrayEvaluation } from './array-storage.js';
import { mapArrayCells } from './array-cell-mapping.js';
import { completed, mapExecution, mapResult, runExecution } from './execution.js';
import { arrayStrides, broadcastOffset, broadcastShape } from './tensor-layout.js';
import { isRankArray, type RankValue } from './value.js';

/** Map a checked scalar body over any finite array operands. Other values
 * remain scalar inputs, so sequences are never implicitly materialized. */
export function mapScalarArrays(args: RankValue[], operation: (cells: RankValue[]) => RankValue): RankValue {
    if (!args.some(isRankArray)) return operation(args);
    const arrays = args.filter(isRankArray);
    const shape = arrays.reduce<readonly number[]>((shape, array) => broadcastShape(shape, array.shape), []);
    const readersFor = (prepared: boolean) => args.map(value => {
        if (!isRankArray(value)) return (_: number) => completed(value);
        const same = value.shape.length === shape.length && value.shape.every((n, i) => n === shape[i]);
        const strides = arrayStrides(value.shape);
        const read = prepared && same ? prepareArrayEvaluation(value)
            : (index: number) => evaluateArrayItem(value, index);
        return (index: number) => read(
            same ? index : broadcastOffset(index, shape, value.shape, strides));
    });
    const readers = readersFor(false);
    const evaluate = (index: number) => mapResult(mapExecution(readers, read => read(index)), operation);
    return mapArrayCells(derivedArray(shape, args, index => runExecution(evaluate(index)), true, evaluate,
        undefined, () => {
            const prepared = readersFor(true);
            return index => runExecution(mapResult(mapExecution(prepared, read => read(index)), operation));
        }),
        args, cells => mapScalarArrays(cells, operation));
}
