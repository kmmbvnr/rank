import { checkpoint } from './interrupt.js';
import { isRankSequence, type RankValue, type SequencePlan } from './value.js';

const memberships = new WeakMap<SequencePlan, {
    readonly contains: NonNullable<SequencePlan['contains']>;
    readonly iterate: SequencePlan['iterate'];
}>();

/** Only runtime constructors may certify an effect-free integer membership test.
 * A name or a host-provided contains method is not such a certificate. */
export function registerSequenceMembership(plan: SequencePlan): void {
    if (plan.contains) memberships.set(plan, { contains: plan.contains, iterate: plan.iterate });
}

export function compiledSequenceMembership(value: RankValue | undefined): ((value: bigint) => boolean) | undefined {
    if (!value || !isRankSequence(value)) return undefined;
    const plan = value.plan, proof = memberships.get(plan);
    if (!proof || Object.getOwnPropertyDescriptor(plan, 'contains')?.value !== proof.contains
        || Object.getOwnPropertyDescriptor(plan, 'iterate')?.value !== proof.iterate) return undefined;
    return integer => { checkpoint(); return proof.contains.call(plan, integer); };
}
