import { prepareIntegerView } from './integer-view.js';
import { checkpoint } from './interrupt.js';
import { compiledSequenceMembership } from './sequence-membership.js';
import { type RankValue } from './value.js';
import { membershipKeys } from './membership-keys.js';

/** Invocation-owned lookup over certified storage; never force host/lazy cells. */
export function compiledIntegerMembership(value: RankValue | undefined, allowChecks = false): ((key: bigint) => boolean) | undefined {
    const sequence = compiledSequenceMembership(value);
    if (sequence) return sequence;
    if (value === undefined) return undefined;
    const view = prepareIntegerView(value, allowChecks);
    if (!view || view.shape.length !== 1) return undefined;
    let keys: { has(key: bigint): boolean } | undefined;
    const index = () => {
        if (keys) return;
        const next = membershipKeys<bigint>(view.shape[0]);
        for (let index = 0; index < view.shape[0]; index++) {
            checkpoint('indexing integer membership');
            next.add(view.read(index));
        }
        keys = next;
    };
    // Filters observe pending domain contracts even for an empty source.
    // Kernel entry must not force cells belonging to an untaken branch.
    if (allowChecks) index();
    return key => { checkpoint('testing integer membership'); index(); return keys!.has(key); };
}
