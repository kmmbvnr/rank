import { collectionProtocol, type CollectionProtocolFor } from '@arrrank/language';
import { ownedArray } from './array-storage.js';
import { checkpoint } from './interrupt.js';
import { RankError } from './errors.js';
import { atSequence, sequence } from './sequence.js';
import { safeDimension } from './tensor-index.js';
import { textPoints } from './text-storage.js';
import type { RankArray, RankQueue, RankSequence, RankValue } from './value.js';

export interface IndexedSource {
    axisSize(axis: number): number;
    at(index: bigint): RankValue;
    build(values: RankValue[]): RankValue;
    readonly tensor?: RankArray;
    openSlice?(start: bigint, step: bigint, axis: number): RankValue | undefined;
}
const checkAxis = (axis: number, name: string): void => {
    if (axis !== 0) throw new RankError(`${name} has no axis ${axis}`);
};
const adapters = {
    array: (value: RankArray): IndexedSource => ({
        tensor: value,
        axisSize: axis => {
            if (axis >= value.shape.length) throw new RankError(`array has no axis ${axis}`);
            return value.shape[axis];
        },
        at: index => value.itemAt?.(Number(index)) ?? value.items[Number(index)], build: ownedArray,
    }),
    text: (value: string): IndexedSource => {
        const points = textPoints(value);
        return { axisSize: axis => { checkAxis(axis, 'text'); return points.length; },
            at: index => points[Number(index)], build: values => values.join('') };
    },
    queue: (value: RankQueue): IndexedSource => ({
        axisSize: axis => { checkAxis(axis, 'queue'); return value.items.length; },
        at: index => value.items[Number(index)], build: ownedArray,
    }),
    sequence: (value: RankSequence): IndexedSource => ({
        axisSize: axis => {
            checkAxis(axis, 'sequence');
            if (value.plan.size.kind !== 'exact') throw new RankError('sequence selection requires an exact finite size');
            return safeDimension(value.plan.size.value, 'sequence size');
        },
        at: index => atSequence(value, index), build: ownedArray,
        openSlice: (start, step, axis) => {
            if (value.plan.size.kind !== 'infinite') return undefined;
            checkAxis(axis, 'sequence');
            if (start < 0n) throw new RankError('array index must be nonnegative on axis 0');
            const count = step < 0n ? start / -step + 1n : undefined;
            return sequence({
                name: `${value.plan.name} slice`,
                size: count === undefined ? { kind: 'infinite' } : { kind: 'exact', value: count },
                at: index => atSequence(value, start + index * step),
                *iterate() {
                    for (let i = 0n; count === undefined || i < count; i++) {
                        checkpoint('reading sequence slice');
                        yield atSequence(value, start + i * step);
                    }
                },
            });
        },
    }),
} satisfies Record<CollectionProtocolFor<'indexed'>, unknown>;

export function indexedSource(value: RankValue): IndexedSource | undefined {
    const protocol = collectionProtocol(typeof value === 'string' ? 'text' : typeof value === 'object' ? value.kind : '', 'indexed');
    if (!protocol || !(protocol in adapters)) return undefined;
    const adapt = adapters[protocol as keyof typeof adapters] as (value: RankValue) => IndexedSource;
    return adapt(value);
}
