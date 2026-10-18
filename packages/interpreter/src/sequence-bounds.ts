import type { RankValue } from './value.js';

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

export function membershipInteger(value: RankValue): bigint | undefined {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
        return BigInt(value);
    }
    return undefined;
}
