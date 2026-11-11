import { demandBudgetEnabled, inspectionEnabled, privateLoopPolling } from './interrupt.js';
import { ownedStorage } from './array-storage-state.js';
import { isRankArray, type RankArray, type RankValue, type SequencePlan } from './value.js';

interface ArithmeticRange {
    readonly start: bigint;
    readonly step: bigint;
    readonly count: bigint;
}
const ranges = new WeakMap<SequencePlan, { range: ArithmeticRange; iterate: SequencePlan['iterate']; at: SequencePlan['at']; size?: SequencePlan['size'] }>();

interface AffineRange {
    source: SequencePlan; scalar: bigint; operator: '+' | '-' | '*'; scalarFirst: boolean;
    iterate: SequencePlan['iterate']; at: SequencePlan['at']; size: SequencePlan['size'];
    parent?: ArithmeticRange; range?: ArithmeticRange;
}
const affineRanges = new WeakMap<SequencePlan, AffineRange>();

/** Register only the runtime's built-in integer map. The source constructor
 * and all intermediate readers are revalidated when a consumer asks for bounds. */
export function registerAffineRange(plan: SequencePlan, source: SequencePlan,
    scalar: RankValue, operator: string, scalarFirst: boolean): void {
    if (typeof scalar !== 'bigint' || operator !== '+' && operator !== '-' && operator !== '*') return;
    affineRanges.set(plan, { source, scalar, operator, scalarFirst,
        iterate: plan.iterate, at: plan.at, size: plan.size });
}

/** Only the range constructor registers this proof; names and host at() hooks
 * cannot establish that a sequence is a pure arithmetic progression. */
export function registerRangePlan(plan: SequencePlan, range: ArithmeticRange): void {
    ranges.set(plan, { range, iterate: plan.iterate, at: plan.at, size: Object.getOwnPropertyDescriptor(plan, 'size')?.value });
}

export function arithmeticRange(plan: SequencePlan, dataHeaders = false, depth = 0): ArithmeticRange | undefined {
    const affine = affineRanges.get(plan);
    if (affine) {
        if (depth >= 128 || !privateLoopPolling() || demandBudgetEnabled() || inspectionEnabled()) return undefined;
        const size = Object.getOwnPropertyDescriptor(plan, 'size')?.value;
        if (Object.getOwnPropertyDescriptor(plan, 'iterate')?.value !== affine.iterate
            || Object.getOwnPropertyDescriptor(plan, 'at')?.value !== affine.at
            || size !== affine.size || !size || typeof size !== 'object'
            || Object.getOwnPropertyDescriptor(size, 'kind')?.value !== 'exact') return undefined;
        const parent = arithmeticRange(affine.source, true, depth + 1);
        if (!parent || Object.getOwnPropertyDescriptor(size, 'value')?.value !== parent.count) return undefined;
        if (affine.parent === parent) return affine.range;
        try {
            const { scalar, operator, scalarFirst } = affine;
            const start = parent.count === 0n ? 0n : operator === '+' ? parent.start + scalar
                : operator === '*' ? parent.start * scalar : scalarFirst ? scalar - parent.start : parent.start - scalar;
            const step = parent.count === 0n ? 0n : operator === '*' ? parent.step * scalar
                : operator === '-' && scalarFirst ? -parent.step : parent.step;
            affine.parent = parent;
            return affine.range = { start, step, count: parent.count };
        } catch (error) {
            // Metadata cannot move a BigInt size error before actual demand.
            if (error instanceof RangeError) return undefined;
            throw error;
        }
    }
    const entry = ranges.get(plan);
    if (entry && dataHeaders) {
        const size = Object.getOwnPropertyDescriptor(plan, 'size')?.value;
        return Object.getOwnPropertyDescriptor(plan, 'iterate')?.value === entry.iterate
            && Object.getOwnPropertyDescriptor(plan, 'at')?.value === entry.at
            && size && size === entry.size && Object.getOwnPropertyDescriptor(size, 'kind')?.value === 'exact'
            && Object.getOwnPropertyDescriptor(size, 'value')?.value === entry.range.count ? entry.range : undefined;
    }
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
