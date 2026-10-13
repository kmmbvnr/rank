import { collectionProtocol, type CollectionProtocolFor } from '@arrrank/language';
import type { RankArray, RankValue } from './value.js';

/** Tensor storage already supplies shape, indexed reads and optional typed buffers.
 * A new tensor protocol supplies this view without changing matrix algorithms. */
const adapters = { array: (value: RankArray): RankArray => value } satisfies Record<CollectionProtocolFor<'tensor'>, unknown>;
export function tensorSource(value: RankValue): RankArray | undefined {
    const protocol = typeof value === 'object' ? collectionProtocol(value.kind, 'tensor') : undefined;
    if (!protocol || !(protocol in adapters)) return undefined;
    const adapt = adapters[protocol as keyof typeof adapters] as (value: RankValue) => RankArray;
    return adapt(value);
}
