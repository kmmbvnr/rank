import { checkpoint } from './interrupt.js';

// The retained table is at most 4 MiB, independent of arbitrary-precision inputs.
const maxTableInteger = 2 ** 20 - 1;
const maxTableValue = BigInt(maxTableInteger);

/** Reused by one interpreter's number operations; no global table or cursor. */
export class Factorizer {
    private smallest = new Uint32Array(0);

    *factors(value: bigint): IterableIterator<bigint> {
        let remaining = value;
        for (let divisor = 2n; remaining > 1n; divisor += divisor === 2n ? 1n : 2n) {
            if (remaining <= maxTableValue) {
                yield* this.bounded(Number(remaining));
                return;
            }
            if (divisor * divisor > remaining) break;
            checkpoint('searching factors', 1, () => ({ divisor: String(divisor), remaining: String(remaining) }));
            while (remaining % divisor === 0n) {
                checkpoint('computing numbers');
                yield divisor;
                remaining /= divisor;
            }
        }
        if (remaining > 1n) yield remaining;
    }

    private *bounded(remaining: number): IterableIterator<bigint> {
        this.prepare(remaining);
        while (remaining > 1) {
            checkpoint('computing numbers');
            const prime = this.smallest[remaining];
            yield BigInt(prime);
            remaining /= prime;
        }
    }

    private prepare(value: number): void {
        if (value < this.smallest.length) return;
        let size = Math.max(256, this.smallest.length);
        while (size <= value) size *= 2;
        const smallest = new Uint32Array(size);
        for (let prime = 2; prime < size; prime++) {
            checkpoint('preparing factor table');
            if (smallest[prime]) continue;
            smallest[prime] = prime;
            let work = 0;
            for (let multiple = prime * prime; multiple < size; multiple += prime) {
                if (!smallest[multiple]) smallest[multiple] = prime;
                if (++work === 1024) { checkpoint('preparing factor table', work); work = 0; }
            }
        }
        // Cancellation must leave the previous, complete table available.
        this.smallest = smallest;
    }
}
