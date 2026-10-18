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

interface ModularRange extends ArithmeticRange { readonly divisor: bigint }
const modularRanges = new WeakMap<SequencePlan, {
    range: ModularRange; source: SequencePlan; iterate: SequencePlan['iterate']; at: SequencePlan['at'];
}>();

/** Register only the runtime's integer remainder over a proved finite range.
 * The tensor backend can lower this without invoking sequence callbacks. */
export function registerModularRange(plan: SequencePlan, source: SequencePlan, divisor: bigint): void {
    const range = arithmeticRange(source);
    if (!range || divisor === 0n) return;
    modularRanges.set(plan, { range: { ...range, divisor }, source, iterate: plan.iterate, at: plan.at });
}

export function modularRange(plan: SequencePlan): ModularRange | undefined {
    const entry = modularRanges.get(plan);
    return entry && arithmeticRange(entry.source) && plan.iterate === entry.iterate && plan.at === entry.at
        && plan.size.kind === 'exact' && plan.size.value === entry.range.count ? entry.range : undefined;
}
