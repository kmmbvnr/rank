import { checkpoint } from '../interrupt.js';
import { RankError } from '../errors.js';
import { expectDeque, expectHeap, peekCollection, pushCollection } from '../containers.js';
import { addToCollection, removeFromCollection } from '../collections.js';
import { RankFenwick } from '../fenwick.js';
import { expectSegment } from '../segment.js';
import { RankWavelet } from '../wavelet.js';
import { expectMultiset, multisetValue } from '../multiset.js';
import { sequence } from '../sequence.js';
import { setValueKey } from '../set.js';
import {
    isRankArray,
    isRankCounter,
    isRankQueue,
    isRankSequence,
    isRankSet,
    type RankArray,
    type RankValue,
} from '../value.js';
import { expectInteger, native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const algoModule: RuntimeModule = {
    fenwick: () => native('fenwick', 1, arguments_ =>
        new RankFenwick(expectInteger(arguments_[0]))),
    wavelet: () => native('wavelet', 1, arguments_ =>
        new RankWavelet(arguments_[0])),
    within: () => native(
        'within', 5, arguments_ =>
            expectWavelet(arguments_[0]).count(
                expectInteger(arguments_[1]),
                expectInteger(arguments_[2]),
                arguments_[3],
                arguments_[4],
            ),
    ),
    sumwithin: () => native(
        'sumwithin', 5, arguments_ =>
            expectWavelet(arguments_[0], 'sumwithin').sum(
                expectInteger(arguments_[1]),
                expectInteger(arguments_[2]),
                arguments_[3],
                arguments_[4],
            ),
    ),
    missing: () => native(
        'missing', 2, arguments_ => {
            const [left, right] = missingBounds(arguments_[1]);
            return expectWavelet(arguments_[0], 'missing')
                .missing(left, right);
        }, 'all', ['all', 1],
    ),
    segment: () => native('segment', 2, () => {
        throw new RankError('segment must follow a binary operation');
    }),
    maxsum: () => native('maxsum', 2, () => {
        throw new RankError('maxsum must be used with segment');
    }),
    query: () => native('query', 3, arguments_ => expectSegment(arguments_[0]).query(
        expectInteger(arguments_[1]),
        expectInteger(arguments_[2]),
    )),
    firstatleast: () => native('firstatleast', 2, arguments_ => {
        const target = arguments_[1];
        if (typeof target !== 'bigint' && typeof target !== 'number') {
            throw new RankError('firstatleast expects a numeric target');
        }
        return expectSegment(arguments_[0]).firstAtLeast(target);
    }),
    push: () => native('push', 2, a => pushCollection(a[0], a[1])),
    pop: () => native('pop', 1, a => peekCollection(a[0], true)),
    peek: () => native('peek', 1, a => peekCollection(a[0], false)),
    pushfront: () => native('pushfront', 2, a => expectDeque(a[0]).pushFront(a[1])),
    pushback: () => native('pushback', 2, a => expectDeque(a[0]).push(a[1])),
    popfront: () => native('popfront', 1, a => expectDeque(a[0]).pop(false)),
    popback: () => native('popback', 1, a => expectDeque(a[0]).pop(true)),
    peekfront: () => native('peekfront', 1, a => expectDeque(a[0]).peek(false)),
    peekback: () => native('peekback', 1, a => expectDeque(a[0]).peek(true)),
    enqueue: () => native('enqueue', 3, a => expectHeap(a[0]).push(a[2], a[1])),
    lowerbound: () => native('lowerbound', 2, a => expectMultiset(a[0]).ceiling(a[1])),
    upperbound: () => native('upperbound', 2, a => expectMultiset(a[0]).upperBound(a[1])),
    multiset: () => native('multiset', 1, arguments_ => multisetValue(arguments_[0])),
    add: () => native('add', 2, arguments_ =>
        addToCollection(arguments_[0], arguments_[1])),
    remove: () => native('remove', 2, arguments_ =>
        removeFromCollection(arguments_[0], arguments_[1])),
    floor: () => native('floor', 2, arguments_ =>
        expectMultiset(arguments_[0]).floor(arguments_[1])),
    ceiling: () => native('ceiling', 2, arguments_ =>
        expectMultiset(arguments_[0]).ceiling(arguments_[1])),
    permutations: () => native('permutations', 1, arguments_ => {
        const input = permutationInput(arguments_[0]);
        return sequence({
            name: 'permutations',
            size: { kind: 'exact', value: permutationCount(input.items) },
            *iterate() {
                yield* permute(input);
            },
        });
    }, 1),
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
    multicomb: () => native('multicomb', 2, arguments_ => {
        const input = combinationInput(arguments_[0], 'multicomb');
        const countValue = expectInteger(arguments_[1]);
        if (countValue < 0n) throw new RankError('multicomb count must be nonnegative');
        if (countValue > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new RankError(`multicomb count is too large: ${countValue}`);
        }
        const count = Number(countValue);
        return sequence({
            name: 'multicomb',
            size: { kind: 'exact', value: multicombCount(input.cells.length, count) },
            *iterate() {
                yield* chooseRepeated(input, count);
            },
        });
    }),
};

function expectWavelet(value: RankValue, name = 'within'): RankWavelet {
    if (value instanceof RankWavelet) return value;
    throw new RankError(`${name} expects a wavelet matrix`);
}

function missingBounds(value: RankValue): [bigint, bigint] {
    if (!isRankArray(value)
        || value.shape.length !== 1
        || value.shape[0] !== 2) {
        throw new RankError('missing expects a two-integer range');
    }
    const item = (index: number) =>
        value.itemAt?.(index) ?? value.items[index];
    return [expectInteger(item(0)), expectInteger(item(1))];
}

interface PermutationInput {
    readonly items: readonly RankValue[];
    readonly text: boolean;
}

function permutationInput(value: RankValue): PermutationInput {
    if (typeof value === 'string') return { items: [...value], text: true };
    if (isRankArray(value) && value.shape.length !== 1) {
        throw new RankError('permutations expects text or a rank-1 collection');
    }
    return { items: finiteItems(value, 'permutations'), text: false };
}

interface CombinationInput {
    readonly cells: readonly RankValue[];
    readonly cellShape: readonly number[];
}

function combinationInput(
    value: RankValue,
    operation = 'combinations',
): CombinationInput {
    if (!isRankArray(value)) {
        return { cells: finiteItems(value, operation), cellShape: [] };
    }
    if (value.shape.length === 0) {
        throw new RankError(`${operation} expects an array with rank at least 1`);
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
    if (isRankCounter(value)) return Array.from(value.entries.values(), entry => entry.value);
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
        checkpoint('computing combinations');
        selected.push(index);
        yield* choose(input, count, index + 1, selected);
        selected.pop();
    }
}

function* chooseRepeated(
    input: CombinationInput,
    count: number,
): IterableIterator<RankArray> {
    if (count === 0) {
        yield { kind: 'array', items: [], shape: [0, ...input.cellShape] };
        return;
    }
    if (input.cells.length === 0) return;

    const selected = Array.from({ length: count }, () => 0);
    while (true) {
        checkpoint('computing combinations');
        const cells = selected.map(index => input.cells[index]);
        const items = input.cellShape.length === 0
            ? cells
            : cells.flatMap(cell => (cell as RankArray).items);
        yield { kind: 'array', items, shape: [count, ...input.cellShape] };

        let position = count - 1;
        while (position >= 0 && selected[position] === input.cells.length - 1) {
            checkpoint('computing combinations');
            position -= 1;
        }
        if (position < 0) return;
        const next = selected[position] + 1;
        selected.fill(next, position);
    }
}

function* permute(input: PermutationInput): IterableIterator<RankArray | string> {
    const used = Array.from({ length: input.items.length }, () => false);
    yield* buildPermutation(input, used, []);
}

function* buildPermutation(
    input: PermutationInput,
    used: boolean[],
    result: RankValue[],
): IterableIterator<RankArray | string> {
    if (result.length === input.items.length) {
        if (input.text) {
            yield result.join('');
        } else {
            yield { kind: 'array', items: [...result], shape: [result.length] };
        }
        return;
    }

    const seen = new Set<string>();
    for (let index = 0; index < input.items.length; index += 1) {
        checkpoint('computing combinations');
        if (used[index]) continue;
        const item = input.items[index];
        const key = setValueKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        used[index] = true;
        result.push(item);
        yield* buildPermutation(input, used, result);
        result.pop();
        used[index] = false;
    }
}

function permutationCount(items: readonly RankValue[]): bigint {
    const counts = new Map<string, number>();
    for (const item of items) {
        checkpoint('computing combinations');
        const key = setValueKey(item);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let result = factorial(items.length);
    for (const count of counts.values()) {
        checkpoint('computing combinations');
        result /= factorial(count);
    }
    return result;
}

function arrayItem(source: RankArray, index: number): RankValue {
    return source.itemAt?.(index) ?? source.items[index];
}

function factorial(value: number): bigint {
    let result = 1n;
    for (let factor = 2n; factor <= BigInt(value); factor += 1n) {
        checkpoint('computing combinations', 1024);
        result *= factor;
    }
    return result;
}

function binomial(size: number, count: number): bigint {
    if (count > size) return 0n;
    const smaller = Math.min(count, size - count);
    let result = 1n;
    for (let step = 1; step <= smaller; step += 1) {
        checkpoint('computing binomial', 1024);
        result = result * BigInt(size - smaller + step) / BigInt(step);
    }
    return result;
}

function multicombCount(size: number, count: number): bigint {
    if (count === 0) return 1n;
    if (size === 0) return 0n;
    const total = BigInt(size) + BigInt(count) - 1n;
    const selections = BigInt(count);
    const kinds = BigInt(size - 1);
    const smaller = selections < kinds ? selections : kinds;
    let result = 1n;
    for (let step = 1n; step <= smaller; step += 1n) {
        checkpoint('computing combinations');
        result = result * (total - smaller + step) / step;
    }
    return result;
}
