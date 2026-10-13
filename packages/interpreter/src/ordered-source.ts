import { collectionProtocol, type CollectionProtocolFor, type CollectionCapability } from '@arrrank/language';
import { ownedArray, denseScalarItems, readArrayItem, realCells, typedArray, typedElementKind } from './array-storage.js';
import { checkpoint } from './interrupt.js';
import { RankDeque } from './containers.js';
import { collectionSize } from './collection-size.js';
import { MissingValueError, RankError } from './errors.js';
import { atSequence, sequence } from './sequence.js';
import { atArray } from './selectors.js';
import { setValueKey } from './set.js';
import { isRankObject, type RankArray, type RankQueue, type RankSequence, type RankSet, type RankValue } from './value.js';

/** Ordered access and rebuilding retain each source's result and laziness rules. */
export interface OrderedSource {
    values(): Iterable<RankValue>;
    build(values: Iterable<RankValue>): RankValue;
    vector?(): RankValue[];
    end?(back: boolean): RankValue;
    reverse?(): RankValue;
    key?(value: RankValue): string;
    readonly alreadyDistinct?: boolean;
}

function reverseText(value: string): string {
    let reversed = '';
    for (let index = value.length - 1; index >= 0; index -= 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xdc00 && code <= 0xdfff && index > 0) {
            const prior = value.charCodeAt(index - 1);
            if (prior >= 0xd800 && prior <= 0xdbff) {
                reversed += value.slice(index - 1, index + 1);
                index -= 1;
                continue;
            }
        }
        reversed += value[index];
    }
    return reversed;
}

function reverseArray(value: RankArray): RankValue {
    if (!value.shape.length) throw new RankError('reverse expects text, an array, a queue or a finite sequence', 'TypeError');
    const [rows, ...rest] = value.shape;
    const width = rest.reduce((product, dimension) => product * dimension, 1);
    const total = rows * width;
    const kind = typedElementKind(value);
    const reals = realCells(value) !== undefined;
    const out: RankValue[] | Float64Array | BigInt64Array = reals ? new Float64Array(total)
        : kind === 'integer' ? new BigInt64Array(total) : new Array(total);
    const cells = out as unknown as RankValue[];
    for (let row = 0; row < rows; row += 1) {
        if ((row & 0xfff) === 0) checkpoint('reversing array');
        const from = (rows - 1 - row) * width;
        for (let column = 0; column < width; column += 1) {
            cells[row * width + column] = readArrayItem(value, from + column);
        }
    }
    if (!Array.isArray(out)) return typedArray(out, value.shape);
    return ownedArray(out, value.shape, denseScalarItems(value) !== undefined);
}

const adapters = {
    array: (value: RankArray, operation: string): OrderedSource => {
        const vector = (): RankValue[] => {
            if (value.shape.length !== 1) throw new RankError(operation === 'unique'
                ? 'unique expects a rank-1 array' : `${operation} expects text or a rank-1 array`);
            return Array.from({ length: value.shape[0] }, (_, index) => readArrayItem(value, index));
        };
        return {
            vector, values: vector,
            build: values => {
                const result = ownedArray([...values]);
                if (operation === 'unique' && value.columnNames)
                    Object.defineProperty(result, 'columnNames', { value: value.columnNames });
                return result;
            },
            end: back => {
                if (!value.shape.length) throw new RankError(`${back ? 'last' : 'first'} expects text, an array, queue or finite sequence`, 'TypeError');
                if (!value.shape[0]) throw new MissingValueError('array is empty');
                return atArray(value, [BigInt(back ? value.shape[0] - 1 : 0)]);
            },
            reverse: () => reverseArray(value),
            key: value.columnNames ? row => {
                if (!isRankObject(row)) throw new RankError('table unique expects object rows', 'TypeError');
                return JSON.stringify(value.columnNames!.map(name => {
                    const cell = row.entries.get(name);
                    return cell === undefined ? null : setValueKey(cell);
                }));
            } : undefined,
        };
    },
    text: (value: string): OrderedSource => ({
        values: () => value, vector: () => [...value], build: values => [...values].join(''),
        end: back => {
            const points = [...value];
            if (!points.length) throw new MissingValueError('text is empty');
            return points[back ? points.length - 1 : 0];
        },
        reverse: () => reverseText(value),
    }),
    queue: (value: RankQueue): OrderedSource => ({
        values: () => value.items,
        build: values => ({ kind: 'queue', items: [...values] }),
        end: back => {
            if (value instanceof RankDeque) return value.peek(back);
            if (!value.items.length) throw new MissingValueError('queue is empty');
            return value.items[back ? value.items.length - 1 : 0];
        },
        reverse: () => ownedArray([...value.items].reverse()),
    }),
    sequence: (value: RankSequence): OrderedSource => ({
        values: () => ({ [Symbol.iterator]: () => value.plan.iterate() }),
        build: values => sequence({ name: `unique ${value.plan.name}`, size: { kind: 'unknown' },
            *iterate() { yield* values; } }),
        end: back => {
            if (!back) return atSequence(value, 0n);
            const length = collectionSize(value)!.length();
            if (!length) throw new MissingValueError('sequence is empty');
            return atSequence(value, length - 1n);
        },
        reverse: () => {
            if (value.plan.size.kind === 'infinite') throw new RankError('reverse requires a finite sequence', 'TypeError');
            return ownedArray([...value.plan.iterate()].reverse());
        },
    }),
    set: (value: RankSet): OrderedSource => ({ values: () => value.entries.values(), build: () => value, alreadyDistinct: true }),
} satisfies Record<CollectionProtocolFor<'ordered' | 'sortable' | 'unique'>, unknown>;

export function orderedSource(value: RankValue, capability: CollectionCapability, operation: string): OrderedSource | undefined {
    const protocol = collectionProtocol(typeof value === 'string' ? 'text' : typeof value === 'object' ? value.kind : '', capability);
    if (!protocol || !(protocol in adapters)) return undefined;
    const adapt = adapters[protocol as keyof typeof adapters] as (value: RankValue, operation: string) => OrderedSource;
    return adapt(value, operation);
}
