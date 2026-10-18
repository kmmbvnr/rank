import type { SequencePlan } from './value.js';

interface ArithmeticRange {
    readonly start: bigint;
    readonly step: bigint;
    readonly count: bigint;
}
const ranges = new WeakMap<SequencePlan, { range: ArithmeticRange; iterate: SequencePlan['iterate']; at: SequencePlan['at'] }>();

/** Only the range constructor registers this proof; names and host at() hooks
 * cannot establish that a sequence is a pure arithmetic progression. */
export function registerRangePlan(plan: SequencePlan, range: ArithmeticRange): void {
    ranges.set(plan, { range, iterate: plan.iterate, at: plan.at });
}

export function arithmeticRange(plan: SequencePlan): ArithmeticRange | undefined {
    const entry = ranges.get(plan);
    return entry && plan.iterate === entry.iterate && plan.at === entry.at
        && plan.size.kind === 'exact' && plan.size.value === entry.range.count ? entry.range : undefined;
}
