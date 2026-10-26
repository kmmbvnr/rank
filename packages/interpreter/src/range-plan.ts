import { ownedStorage } from './array-storage-state.js';
import { isRankArray, type RankArray, type RankValue, type SequencePlan } from './value.js';

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

// Materialization preserves a constructor proof until a tracked or host write.
const arrayRanges = new WeakMap<RankArray, { range: ArithmeticRange; revision: number }>();
const mappedRanges = new WeakMap<RankArray, {
    source: RankArray; range: ArithmeticRange; sourceRange: ArithmeticRange; reader: RankArray['itemAt'];
}>();

/** Affine integer arithmetic over a constructor-proved range is another range.
 * Retain only the recipe proof; a changed source or reader invalidates it. */
export function registerMappedArrayRange(value: RankArray, operator: string, left: RankValue, right: RankValue): void {
    if (operator !== '+' && operator !== '-' && operator !== '*' || value.shape.length !== 1
        || value.itemAt === undefined) return;
    const source = isRankArray(left) && typeof right === 'bigint' ? left
        : isRankArray(right) && typeof left === 'bigint' ? right : undefined;
    if (!source) return;
    const range = arrayRange(source);
    if (!range || BigInt(value.shape[0]) !== range.count) return;
    const scalar = (source === left ? right : left) as bigint;
    const start = operator === '+' ? range.start + scalar
        : operator === '*' ? range.start * scalar
        : source === left ? range.start - scalar : scalar - range.start;
    const step = operator === '*' ? range.step * scalar
        : operator === '-' && source === right ? -range.step : range.step;
    mappedRanges.set(value, { source, sourceRange: range, reader: value.itemAt,
        range: { start, step, count: range.count } });
}
export function registerArrayRange(value: RankArray, range: ArithmeticRange): RankArray {
    const state = ownedStorage.get(value);
    if (state) arrayRanges.set(value, { range, revision: state.revision });
    return value;
}

export function arrayRange(value: RankArray, depth = 0): ArithmeticRange | undefined {
    const entry = arrayRanges.get(value), state = ownedStorage.get(value);
    if (entry && state?.stable && state.scalarOnly && state.revision === entry.revision
        && value.itemAt === undefined && value.shape.length === 1
        && BigInt(value.shape[0]) === entry.range.count) return entry.range;
    const mapped = mappedRanges.get(value);
    return mapped && depth < 128 && value.itemAt === mapped.reader && value.shape.length === 1
        && BigInt(value.shape[0]) === mapped.range.count
        && arrayRange(mapped.source, depth + 1) === mapped.sourceRange ? mapped.range : undefined;
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
