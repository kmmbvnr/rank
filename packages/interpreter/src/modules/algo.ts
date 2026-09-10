import { RankError } from '../errors.js';
import { sequence } from '../sequence.js';
import {
    isRankArray,
    isRankQueue,
    isRankSequence,
    isRankSet,
    type RankArray,
    type RankValue,
} from '../value.js';
import { expectInteger, native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const algoModule: RuntimeModule = {
    permutations: () => native('permutations', 1, arguments_ => {
        const items = finiteItems(arguments_[0], 'permutations');
        return sequence({
            name: 'permutations',
            size: { kind: 'exact', value: factorial(items.length) },
            *iterate() {
                yield* permute([...items], 0);
            },
        });
    }),
    combinations: () => native('combinations', 2, arguments_ => {
        const input = combinationInput(arguments_[0]);
        const countValue = expectInteger(arguments_[1]);
        if (countValue < 0n) throw new RankError('combination count must be nonnegative');
        if (countValue > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new RankError(`combination count is too large: ${countValue}`);
        }
        const count = Number(countValue);
        return sequence({
            name: 'combinations',
            size: { kind: 'exact', value: binomial(input.cells.length, count) },
            *iterate() {
                yield* choose(input, count, 0, []);
            },
        });
    }),
};

interface CombinationInput {
    readonly cells: readonly RankValue[];
    readonly cellShape: readonly number[];
}

function combinationInput(value: RankValue): CombinationInput {
    if (!isRankArray(value)) {
        return { cells: finiteItems(value, 'combinations'), cellShape: [] };
    }
    if (value.shape.length === 0) {
        throw new RankError('combinations expects an array with rank at least 1');
    }

    const cellShape = value.shape.slice(1);
    const cellSize = cellShape.reduce((product, dimension) => product * dimension, 1);
    const cells = Array.from({ length: value.shape[0] }, (_, position): RankValue => {
        if (cellShape.length === 0) return arrayItem(value, position);
        const start = position * cellSize;
        return {
            kind: 'array',
            items: Array.from({ length: cellSize }, (_, offset) => arrayItem(value, start + offset)),
            shape: cellShape,
        };
    });
    return { cells, cellShape };
}

function finiteItems(value: RankValue, operation: string): RankValue[] {
    if (isRankArray(value)) return Array.from(
        { length: value.items.length },
        (_, index) => arrayItem(value, index),
    );
    if (isRankQueue(value)) return [...value.items];
    if (isRankSet(value)) return [...value.entries.values()];
    if (isRankSequence(value)) {
        if (value.plan.size.kind === 'infinite') {
            throw new RankError(`${operation} requires a bounded sequence`);
        }
        return [...value.plan.iterate()];
    }
    throw new RankError(`${operation} expects a finite collection`);
}

function* choose(
    input: CombinationInput,
    count: number,
    start: number,
    selected: number[],
): IterableIterator<RankArray> {
    if (selected.length === count) {
        const cells = selected.map(index => input.cells[index]);
        const items = input.cellShape.length === 0
            ? cells
            : cells.flatMap(cell => (cell as RankArray).items);
        yield { kind: 'array', items, shape: [count, ...input.cellShape] };
        return;
    }

    const needed = count - selected.length;
    for (let index = start; index <= input.cells.length - needed; index += 1) {
        selected.push(index);
        yield* choose(input, count, index + 1, selected);
        selected.pop();
    }
}

function* permute(items: RankValue[], start: number): IterableIterator<RankArray> {
    if (start === items.length) {
        yield { kind: 'array', items: [...items], shape: [items.length] };
        return;
    }
    for (let index = start; index < items.length; index += 1) {
        [items[start], items[index]] = [items[index], items[start]];
        yield* permute(items, start + 1);
        [items[start], items[index]] = [items[index], items[start]];
    }
}

function arrayItem(source: RankArray, index: number): RankValue {
    return source.itemAt?.(index) ?? source.items[index];
}

function factorial(value: number): bigint {
    let result = 1n;
    for (let factor = 2n; factor <= BigInt(value); factor += 1n) result *= factor;
    return result;
}

function binomial(size: number, count: number): bigint {
    if (count > size) return 0n;
    const smaller = Math.min(count, size - count);
    let result = 1n;
    for (let step = 1; step <= smaller; step += 1) {
        result = result * BigInt(size - smaller + step) / BigInt(step);
    }
    return result;
}
