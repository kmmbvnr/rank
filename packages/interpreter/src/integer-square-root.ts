import { checkpoint } from './interrupt.js';

/** Return the exact floor of the square root using integer Newton iteration. */
export function integerSquareRoot(value: bigint): bigint {
    if (value < 2n) return value;
    const bits = BigInt(value.toString(2).length);
    let root = 1n << ((bits + 1n) / 2n);
    for (;;) {
        checkpoint('computing numbers');
        const next = (root + value / root) / 2n;
        if (next >= root) return root;
        root = next;
    }
}

