import { readArrayItem } from '../array-storage.js';
import { RankError } from '../errors.js';
import { checkpoint } from '../interrupt.js';
import { compareOrderedValues, orderedKind } from '../ordered.js';
import { sequence } from '../sequence.js';
import {
    isRankArray,
    isRankSequence,
    type NativeFunction,
    type RankSequence,
    type RankValue,
    type SequenceSize,
} from '../value.js';

/** One sorted input of a merge: how to open it again and what is known of its length. */
interface Stream {
    readonly size: SequenceSize;
    readonly singlePass: boolean;
    open(): Iterator<RankValue>;
}

interface Entry {
    value: RankValue;
    key: RankValue;
    readonly stream: number;
}

/**
 * `Streams merge` and `A B merge`: the items of several sorted
 * inputs as one lazy sorted sequence. The rows of a rank-2 array, or the items
 * of a collection of rank-1 arrays and sequences, are the inputs of the first
 * form; the second merges two rank-1 collections. Every input is read only as
 * far as the merged result is demanded, one item ahead of the output, so an
 * endless sorted sequence can be merged and a lazy table such as an `outer`
 * result is never held whole. Equal items leave in the order of their inputs.
 * An input that turns out not to be sorted in the merge direction is an error.
 */
export function mergeSorted(operands: readonly RankValue[], descending: boolean,
    project: (value: RankValue) => RankValue = value => value): RankSequence {
    const streams = operands.length === 2
        ? operands.map(operand => collectionStream(operand))
        : streamsOf(operands[0]);
    return sequence({
        name: 'merge',
        singlePass: streams.some(stream => stream.singlePass),
        size: mergedSize(streams),
        iterate: () => mergeValues(streams, descending, project),
    });
}

/** The standard `merge` fixed to one direction. */
export function directedMerge(fn: NativeFunction, descending: boolean): NativeFunction {
    return { ...fn, call: args => mergeSorted(args, descending) };
}

function streamsOf(value: RankValue): Stream[] {
    if (isRankArray(value) && value.shape.length === 2) {
        const [rows, width] = value.shape;
        return Array.from({ length: rows }, (_, row) => ({
            size: { kind: 'exact', value: BigInt(width) } as const,
            singlePass: false,
            open: () => cells(value, row * width, width),
        }));
    }
    if (isRankArray(value) && value.shape.length === 1) {
        return Array.from({ length: value.shape[0] }, (_, row) => collectionStream(readArrayItem(value, row)));
    }
    if (isRankSequence(value) && value.plan.size.kind !== 'infinite') {
        const streams: Stream[] = [];
        for (const item of value.plan.iterate()) {
            checkpoint('opening merge streams');
            streams.push(collectionStream(item));
        }
        return streams;
    }
    throw new RankError('merge expects the rows of a rank-2 array, a finite collection of sorted '
        + 'collections, or two sorted collections', 'TypeError');
}

function collectionStream(value: RankValue): Stream {
    if (isRankArray(value) && value.shape.length === 1) {
        const [length] = value.shape;
        return { size: { kind: 'exact', value: BigInt(length) }, singlePass: false,
            open: () => cells(value, 0, length) };
    }
    if (isRankSequence(value)) {
        const plan = value.plan;
        return { size: plan.size, singlePass: plan.singlePass === true,
            open: () => plan.iterate() };
    }
    throw new RankError('merge expects rank-1 arrays or sequences as its sorted inputs', 'TypeError');
}

function* cells(array: Parameters<typeof readArrayItem>[0], start: number, count: number): IterableIterator<RankValue> {
    for (let index = 0; index < count; index += 1) yield readArrayItem(array, start + index);
}

function mergedSize(streams: readonly Stream[]): SequenceSize {
    let total = 0n;
    let known = true;
    for (const stream of streams) {
        if (stream.size.kind === 'infinite') return stream.size;
        if (stream.size.kind === 'exact') total += stream.size.value;
        else known = false;
    }
    return known ? { kind: 'exact', value: total } : { kind: 'unknown' };
}

/** Rank's shared ordering, with the numeric case settled without a kind lookup. */
function order(left: RankValue, right: RankValue): number {
    if ((typeof left === 'bigint' || typeof left === 'number')
        && (typeof right === 'bigint' || typeof right === 'number')) {
        return left < right ? -1 : left > right ? 1 : 0;
    }
    return compareOrderedValues(left, right, orderedKind(left));
}

function* mergeValues(streams: readonly Stream[], descending: boolean,
    project: (value: RankValue) => RankValue): IterableIterator<RankValue> {
    const direction = descending ? 'descending' : 'ascending';
    const iterators = streams.map(stream => stream.open());
    // The item that leaves first is the largest (descending) or smallest one; of equal items, the earlier input's.
    const before = (a: Entry, b: Entry): boolean => {
        const difference = order(a.key, b.key);
        return difference === 0 ? a.stream < b.stream : descending ? difference > 0 : difference < 0;
    };
    const heap: Entry[] = [];
    const siftDown = (from: number): void => {
        let index = from;
        for (;;) {
            const left = index * 2 + 1;
            if (left >= heap.length) return;
            const right = left + 1;
            const child = right < heap.length && before(heap[right], heap[left]) ? right : left;
            if (!before(heap[child], heap[index])) return;
            [heap[index], heap[child]] = [heap[child], heap[index]];
            index = child;
        }
    };
    const siftUp = (from: number): void => {
        let index = from;
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (!before(heap[index], heap[parent])) return;
            [heap[index], heap[parent]] = [heap[parent], heap[index]];
            index = parent;
        }
    };
    try {
        iterators.forEach((iterator, stream) => {
            const first = iterator.next();
            if (first.done) return;
            heap.push({ value: first.value, key: project(first.value), stream });
            siftUp(heap.length - 1);
        });
        while (heap.length > 0) {
            checkpoint('merging sequences');
            const { value, stream } = heap[0];
            yield value;
            const next = iterators[stream].next();
            if (next.done) {
                const last = heap.pop()!;
                if (heap.length > 0) {
                    heap[0] = last;
                    siftDown(0);
                }
                continue;
            }
            const key = project(next.value);
            const difference = order(heap[0].key, key);
            if (descending ? difference < 0 : difference > 0) {
                throw new RankError(`merge expects ${direction} inputs, but input ${stream + 1} is not`, 'DomainError');
            }
            heap[0] = { value: next.value, key, stream };
            siftDown(0);
        }
    } finally {
        for (const iterator of iterators) iterator.return?.();
    }
}
