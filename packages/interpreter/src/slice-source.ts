import { collectionProtocol, type CollectionProtocolFor } from '@arrrank/language';
import { derivedArray, readArrayItem } from './array-storage.js';
import { registerScalarView } from './integer-view.js';
import { checkpoint } from './interrupt.js';
import { sequence } from './sequence.js';
import type { RankArray, RankSequence, RankValue, SequenceSize } from './value.js';

export interface SliceSource {
    slice(count: bigint, drop: boolean): RankValue;
}

const adapters = {
    text: (source: string): SliceSource => ({ slice(count, drop) {
        const points = [...source];
        const offset = Number(count < BigInt(points.length) ? count : BigInt(points.length));
        return (drop ? points.slice(offset) : points.slice(0, offset)).join('');
    } }),
    array: (source: RankArray): SliceSource => ({ slice(count, drop) {
        const length = source.shape[0];
        const offset = Number(count < BigInt(length) ? count : BigInt(length));
        const cellSize = source.shape.slice(1).reduce((a, b) => a * b, 1);
        const shape = [drop ? length - offset : offset, ...source.shape.slice(1)];
        const position = (index: number) => index + (drop ? offset * cellSize : 0);
        return registerScalarView(derivedArray(shape, [source], index =>
            readArrayItem(source, position(index))), source, position, { linear: () => ({ offset: drop ? offset * cellSize : 0, stride: 1 }) });
    } }),
    sequence: (source: RankSequence): SliceSource => ({ slice(count, drop) {
        const name = drop ? 'drop' : 'take';
        const plan = source.plan;
        const size: SequenceSize = plan.size.kind === 'exact'
            ? { kind: 'exact', value: drop
                ? (plan.size.value > count ? plan.size.value - count : 0n)
                : (plan.size.value < count ? plan.size.value : count) }
            : drop ? plan.size
                : plan.size.kind === 'infinite' || count === 0n
                    ? { kind: 'exact', value: count }
                    : { kind: 'unknown' };
        return sequence({
            name: `${plan.name} ${count} ${name}`,
            singlePass: plan.singlePass,
            captures: plan.captures,
            size,
            *iterate() {
                if (!drop && count === 0n) return;
                let remaining = count;
                for (const value of plan.iterate()) {
                    checkpoint('reading sequence');
                    if (drop) {
                        if (remaining > 0n) remaining -= 1n;
                        else yield value;
                    } else {
                        yield value;
                        remaining -= 1n;
                        if (remaining === 0n) return;
                    }
                }
            },
        });
    } }),
} satisfies Record<CollectionProtocolFor<'slice'>, unknown>;

export function sliceSource(value: RankValue): SliceSource | undefined {
    const protocol = collectionProtocol(typeof value === 'string' ? 'text' : typeof value === 'object' ? value.kind : '', 'slice');
    if (!protocol || !(protocol in adapters)) return undefined;
    if (protocol === 'array' && !(value as RankArray).shape.length) return undefined;
    const adapt = adapters[protocol as keyof typeof adapters] as (value: RankValue) => SliceSource;
    return adapt(value);
}
