import { derivedArray, ownedArray, readArrayItem } from './array-storage.js';
import { MissingValueError, RankError } from './errors.js';
import { standardModules } from './modules/index.js';
import type { RuntimeModule } from './modules/types.js';
import { sumIndexed } from './modules/numbers.js';
import { statisticsCell } from './modules/stats.js';
import { numericKernel } from './numeric-kernels.js';
import { reduceWindowCell, scanSequence } from './sequence.js';
import { isNativeFunction, isRankArray, isRankQueue, isRankSequence, valueRank,
    type NativeFunction, type RankArray, type RankValue } from './value.js';

const arrayItem = readArrayItem;
const arraySize = (shape: readonly number[]): number =>
    shape.reduce((product, dimension) => product * dimension, 1);
const array = (items: RankValue[]): RankArray => ownedArray(items);

function lazyArray(shape: readonly number[], itemAt: (index: number) => RankValue): RankArray {
    let materialized: RankValue[] | undefined;
    return {
        kind: 'array', shape, itemAt,
        get items() {
            materialized ??= Array.from({ length: arraySize(shape) }, (_, index) => itemAt(index));
            return materialized;
        },
    };
}

/** Numeric and axis reductions share validation, cell traversal and lazy frame assembly. */
export class ReductionEvaluator {
    constructor(
        private readonly binary: (operator: string, left: RankValue, right: RankValue) => RankValue,
        private readonly resolve: (name: string) => RankValue,
        private readonly standardFunctions: ReadonlyMap<RuntimeModule[string], NativeFunction>,
        private readonly tensorFusion: boolean,
    ) {}

    evaluateReduction(
        operator: string,
        value: RankValue,
        cellRank?: number,
        seed?: RankValue,
    ): RankValue {
        if (cellRank === undefined) return this.reduceCell(operator, value, seed);
        if (isRankArray(value)) {
            if (cellRank > value.shape.length) {
                throw new RankError(`rank ${cellRank} exceeds tensor rank ${value.shape.length}`);
            }
            if (cellRank === value.shape.length) return this.reduceCell(operator, value, seed);
            const frameShape = value.shape.slice(0, value.shape.length - cellRank);
            const cellShape = value.shape.slice(value.shape.length - cellRank);
            const cellSize = arraySize(cellShape);
            return derivedArray(frameShape, [value], frameIndex => {
                const start = frameIndex * cellSize;
                return cellRank === 0
                    ? this.reduceCell(operator, arrayItem(value, start), seed)
                    : this.reduceArrayCell(operator, value, start, cellSize, seed);
            }, true);
        }
        if (cellRank > valueRank(value)) {
            throw new RankError(`rank ${cellRank} exceeds value rank ${valueRank(value)}`);
        }
        return this.reduceCell(operator, value, seed);
    }

    evaluateScan(operator: string, value: RankValue, seed?: RankValue): RankValue {
        return this.scanValues(value, operator, seed,
            numericKernel(operator, (a, b) => this.binary(operator, a, b)));
    }

    scanValues(value: RankValue, operator: string, seed: RankValue | undefined,
        operation: (left: RankValue, right: RankValue) => RankValue): RankValue {
        if (valueRank(value) !== 1) {
            throw new RankError(`${operator} scan expects a rank-1 value`);
        }
        if (isRankSequence(value)) {
            return scanSequence(value, operator, seed, operation);
        }
        const result: RankValue[] = [];
        if (seed !== undefined) result.push(seed);
        if (isRankArray(value)) {
            const size = arraySize(value.shape);
            if (size === 0) return array(result);
            let accumulated = seed === undefined
                ? arrayItem(value, 0)
                : operation(seed, arrayItem(value, 0));
            result.push(accumulated);
            for (let index = 1; index < size; index += 1) {
                accumulated = operation(accumulated, arrayItem(value, index));
                result.push(accumulated);
            }
            return array(result);
        }
        let accumulated: RankValue | undefined = seed;
        for (const item of reductionValues(value, operator)) {
            accumulated = accumulated === undefined
                ? item
                : operation(accumulated, item);
            result.push(accumulated);
        }
        return ownedArray(result);
    }

    evaluateAxisReduction(
        operation: string,
        value: RankValue,
        axes: readonly number[],
    ): RankValue {
        if (!isRankArray(value)) throw new RankError(`${operation} axis expects an array`);
        for (const axis of axes) {
            if (axis >= value.shape.length) throw new RankError(`array has no axis ${axis}`);
        }
        if (new Set(axes).size !== axes.length) {
            throw new RankError(`${operation} axes must be unique`);
        }

        const selected = new Set(axes);
        const reducedAxes = value.shape.map((_, axis) => axis).filter(axis => selected.has(axis));
        const frameAxes = value.shape.map((_, axis) => axis).filter(axis => !selected.has(axis));
        const reducedShape = reducedAxes.map(axis => value.shape[axis]);
        const frameShape = frameAxes.map(axis => value.shape[axis]);
        const reducer = this.resolve(operation);
        if (!isNativeFunction(reducer)) throw new RankError(`${operation} is not an operation`);

        const strides = value.shape.map(() => 1);
        for (let axis = strides.length - 2; axis >= 0; axis -= 1) {
            strides[axis] = strides[axis + 1] * value.shape[axis + 1];
        }
        const reducedSize = arraySize(reducedShape);
        const offsetAt = (index: number, axes: readonly number[]): number => {
            let offset = 0;
            for (let current = axes.length - 1; current >= 0; current -= 1) {
                const axis = axes[current];
                offset += (index % value.shape[axis]) * strides[axis];
                index = Math.floor(index / value.shape[axis]);
            }
            return offset;
        };
        // Lazy cells must still be fully read before the reducer validates them.
        const directSum = operation === 'sum' && value.itemAt === undefined
            && reducer === this.standardFunctions.get(standardModules.core.sum);

        const reduceAt = (frameIndex: number): RankValue => {
            const start = offsetAt(frameIndex, frameAxes);
            const itemAt = (index: number) => arrayItem(value, start + offsetAt(index, reducedAxes));
            if (directSum) return sumIndexed(reducedSize, itemAt);
            if (this.tensorFusion
                && (operation === 'mean' || operation === 'std')
                && reducer === this.standardFunctions.get(standardModules.stats[operation])) {
                return statisticsCell(operation, reducedSize, itemAt);
            }
            const items: RankValue[] = [];
            for (let index = 0; index < reducedSize; index += 1) {
                try {
                    items.push(itemAt(index));
                } catch (error) {
                    if (!(error instanceof MissingValueError)
                        || (operation !== 'mean' && operation !== 'median' && operation !== 'std')) {
                        throw error;
                    }
                }
            }
            const shape = items.length === reducedSize ? reducedShape : [items.length];
            return reducer.call([{ kind: 'array', items, shape }]);
        };

        if (frameShape.length === 0) return reduceAt(0);
        const builtin = ['core', 'numbers', 'stats', 'sequences'].some(module => {
            const definition = standardModules[module][operation];
            return definition !== undefined && reducer === this.standardFunctions.get(definition);
        });
        return builtin ? derivedArray(frameShape, [value], reduceAt, true)
            : lazyArray(frameShape, reduceAt);
    }

    private reduceCell(operator: string, value: RankValue, seed?: RankValue): RankValue {
        if (isRankArray(value)) return this.reduceArrayCell(operator, value, 0, arraySize(value.shape), seed);
        if (seed === undefined && isRankSequence(value)) {
            const planned = value.plan.reduce?.(operator);
            if (planned !== undefined) return planned;
        }
        const values = reductionValues(value, operator);
        const first = values.next();
        if (first.done) return seed === undefined ? reductionIdentity(operator) : seed;
        const operation = numericKernel(operator, (a, b) => this.binary(operator, a, b));
        let result = seed === undefined ? first.value : operation(seed, first.value);
        for (let next = values.next(); !next.done; next = values.next()) {
            result = operation(result, next.value);
        }
        return result;
    }

    private reduceArrayCell(
        operator: string,
        value: RankArray,
        start: number,
        size: number,
        seed?: RankValue,
    ): RankValue {
        if (size === 0) return seed === undefined ? reductionIdentity(operator) : seed;
        const operation = numericKernel(operator, (a, b) => this.binary(operator, a, b));
        if (seed === undefined && this.tensorFusion) {
            const folded = reduceWindowCell(value, start, size, operation);
            if (folded !== undefined) return folded;
        }
        let result = seed === undefined
            ? arrayItem(value, start)
            : operation(seed, arrayItem(value, start));
        const end = start + size;
        for (let index = start + 1; index < end; index += 1) {
            result = operation(result, arrayItem(value, index));
        }
        return result;
    }

}

export function* reductionValues(value: RankValue, operation: string): IterableIterator<RankValue> {
    if (isRankArray(value)) {
        for (let index = 0; index < arraySize(value.shape); index += 1) {
            yield arrayItem(value, index);
        }
        return;
    }
    if (isRankQueue(value)) {
        yield* value.items;
        return;
    }
    if (typeof value === 'string') {
        yield* value;
        return;
    }
    if (isRankSequence(value)) {
        if (value.plan.size.kind === 'infinite') {
            throw new RankError(`${operation} reduce requires a bounded sequence`);
        }
        yield* value.plan.iterate();
        return;
    }
    yield value;
}

function reductionIdentity(operator: string): RankValue {
    if (operator === '+') return 0n;
    if (operator === '*') return 1n;
    if (operator === 'and') return true;
    if (operator === 'or' || operator === 'xor') return false;
    throw new RankError(`${operator} reduce does not define a value for an empty cell`);
}
