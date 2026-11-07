import { checkpoint, privateLoopPolling } from '../interrupt.js';

export function greatestCommonDivisor(left: bigint, right: bigint): bigint {
    const x = Number(left), y = Number(right);
    if (privateLoopPolling() && Number.isSafeInteger(x) && Number.isSafeInteger(y)) {
        checkpoint('computing numbers');
        return BigInt(safeIntegerGcd(x, y));
    }
    let a = left < 0n ? -left : left;
    let b = right < 0n ? -right : right;
    while (b !== 0n) {
        checkpoint('computing numbers');
        [a, b] = [b, a % b];
    }
    return a;
}

/** Euclid over safe integers: remainder and absolute value stay exact. */
export function safeIntegerGcd(left: number, right: number): number {
    let a = Math.abs(left), b = Math.abs(right);
    while (b !== 0) {
        const remainder = a % b;
        a = b;
        b = remainder;
    }
    return a;
}

/** Divide before multiplying; both scalar and stored-array LCM stay exact. */
export function leastCommonMultiple(left: bigint, right: bigint): bigint {
    if (left === 0n || right === 0n) return 0n;
    const result = left / greatestCommonDivisor(left, right) * right;
    return result < 0n ? -result : result;
}
