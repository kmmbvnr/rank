import { prepareIntegerView } from './integer-view.js';
import { checkpoint } from './interrupt.js';
import { compiledSequenceMembership } from './sequence-membership.js';
import { type RankValue } from './value.js';

/** Invocation-owned lookup over certified storage; never force host/lazy cells. */
export function compiledIntegerMembership(value: RankValue | undefined): ((key: bigint) => boolean) | undefined {
    const sequence = compiledSequenceMembership(value);
    if (sequence) return sequence;
    if (value === undefined) return undefined;
    const view = prepareIntegerView(value, true);
    if (!view || view.shape.length !== 1) return undefined;
    const keys = new Set<bigint>();
    for (let index = 0; index < view.shape[0]; index++) {
        checkpoint('indexing integer membership');
        keys.add(view.read(index));
    }
    return key => { checkpoint('testing integer membership'); return keys.has(key); };
}
