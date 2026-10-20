import { checkpoint } from './interrupt.js';

export function greatestCommonDivisor(left: bigint, right: bigint): bigint {
    let a = left < 0n ? -left : left;
    let b = right < 0n ? -right : right;
    while (b !== 0n) {
        checkpoint('computing numbers');
        [a, b] = [b, a % b];
    }
    return a;
}
