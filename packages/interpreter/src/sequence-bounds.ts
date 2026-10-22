import type { RankValue, SequencePlan } from './value.js';

const metadataBounds = new WeakMap<SequencePlan, {
    upper: SequencePlan['withUpperBound']; lower: SequencePlan['withLowerBound'];
}>();

/** These constructors only record bounds, and return plans with the same
 * capability. They must not inspect source cells or invoke guest callbacks. */
export function registerMetadataBounds(plan: SequencePlan): void {
    if (plan.withUpperBound && plan.withLowerBound) metadataBounds.set(plan, {
        upper: plan.withUpperBound, lower: plan.withLowerBound,
    });
}

export function hasMetadataBounds(plan: SequencePlan): boolean {
    const proof = metadataBounds.get(plan);
    return !!proof && Object.getOwnPropertyDescriptor(plan, 'withUpperBound')?.value === proof.upper
        && Object.getOwnPropertyDescriptor(plan, 'withLowerBound')?.value === proof.lower;
}

export interface Boundary {
    readonly limit: bigint;
    readonly inclusive: boolean;
}

export function within(value: bigint, boundary: Boundary): boolean {
    return boundary.inclusive ? value <= boundary.limit : value < boundary.limit;
}

export function above(value: bigint, boundary: Boundary): boolean {
    return boundary.inclusive ? value >= boundary.limit : value > boundary.limit;
}

export function strongerLower(left: Boundary | undefined, right: Boundary): Boundary {
    if (!left || right.limit > left.limit) return right;
    if (left.limit > right.limit) return left;
    return { limit: left.limit, inclusive: left.inclusive && right.inclusive };
}

export function strongerUpper(left: Boundary | undefined, right: Boundary): Boundary {
    if (!left || right.limit < left.limit) return right;
    if (left.limit < right.limit) return left;
    return { limit: left.limit, inclusive: left.inclusive && right.inclusive };
}

export function membershipInteger(value: RankValue): bigint | undefined {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
        return BigInt(value);
    }
    return undefined;
}
