import { checkpoint } from './interrupt.js';

const ESTIMATE_LIMIT = 1n << 63n;

/** A floating estimate is only a seed. BigInt comparisons establish the exact
 * floor even when Number(value) rounds across a perfect-square boundary. */
export function integerSquareRoot(value: bigint): bigint {
    if (value < 2n) return value;
    if (value < ESTIMATE_LIMIT) {
        checkpoint('computing numbers');
        let root = BigInt(Math.floor(Math.sqrt(Number(value))));
        while (root * root > value) root -= 1n;
        while ((root + 1n) * (root + 1n) <= value) root += 1n;
        return root;
    }
    const bits = BigInt(value.toString(2).length);
    let root = 1n << ((bits + 1n) / 2n);
    for (;;) {
        checkpoint('computing numbers');
        const next = (root + value / root) / 2n;
        if (next >= root) return root;
        root = next;
    }
}

/** Exact floor for a nonnegative safe integer. The floating root is only a seed. */
export function safeIntegerSquareRoot(value: number): number {
    let root = Math.floor(Math.sqrt(value));
    while (root * root > value) root--;
    while ((root + 1) * (root + 1) <= value) root++;
    return root;
}
