import { checkpoint, privateLoopPolling } from './interrupt.js';

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
