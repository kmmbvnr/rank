import { checkpoint } from './interrupt.js';
import { isRankSequence, type RankValue, type SequencePlan } from './value.js';

const memberships = new WeakMap<SequencePlan, {
    readonly contains: NonNullable<SequencePlan['contains']>;
    readonly iterate: SequencePlan['iterate'];
    readonly numberContains?: (value: number) => boolean;
}>();

/** Only runtime constructors may certify an effect-free integer membership test.
 * A name or a host-provided contains method is not such a certificate. */
export function registerSequenceMembership(plan: SequencePlan, numberContains?: (value: number) => boolean): void {
    if (plan.contains) memberships.set(plan, { contains: plan.contains, iterate: plan.iterate, numberContains });
}

export function compiledSequenceMembership(value: RankValue | undefined): ((value: bigint) => boolean) | undefined {
    if (!value || !isRankSequence(value)) return undefined;
    const plan = value.plan, proof = memberships.get(plan);
    if (!proof || Object.getOwnPropertyDescriptor(plan, 'contains')?.value !== proof.contains
        || Object.getOwnPropertyDescriptor(plan, 'iterate')?.value !== proof.iterate) return undefined;
    return integer => { checkpoint(); return proof.contains.call(plan, integer); };
}

/** Safe Number regions use the same captured proof and entry-time guards.
 * Constructors may provide an allocation-free reader; other certified plans
 * retain exact BigInt membership rather than guessing from their name. */
export function compiledNumberSequenceMembership(value: RankValue | undefined, context?: string): ((value: number) => boolean) | undefined {
    if (!value || !isRankSequence(value)) return undefined;
    const plan = value.plan, proof = memberships.get(plan);
    if (!proof || Object.getOwnPropertyDescriptor(plan, 'contains')?.value !== proof.contains
        || Object.getOwnPropertyDescriptor(plan, 'iterate')?.value !== proof.iterate) return undefined;
    return integer => {
        checkpoint(context);
        return Number.isSafeInteger(integer) && (proof.numberContains
            ? proof.numberContains(integer) : proof.contains.call(plan, BigInt(integer)));
    };
}
