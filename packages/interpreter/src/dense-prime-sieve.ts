import { RankError } from './errors.js';
import { checkpoint, checkInterrupt } from './interrupt.js';
import { above, within, strongerLower, strongerUpper, membershipInteger, registerMetadataBounds, type Boundary } from './sequence-bounds.js';
import { registerStoredSequence } from './stored-value.js';
import { registerSequenceMembership } from './sequence-membership.js';
import type { RankValue, SequencePlan } from './value.js';

// At most 256 MiB of odd flags; bit offsets remain below 2^31.
export const maxDensePrimeInteger = 2 ** 32 - 1;

// Rank checkpoints every 256 bitmap bytes; a query scans at most one block.
const countBlockBytes = 256;
const bitCounts = Uint8Array.from({ length: 256 }, (_, n) => {
    let count = 0;
    for (; n; n &= n - 1) count++;
    return count;
});

/** Immutable, explicitly bounded sieve. One bit per odd integer, including 1. */
export class DensePrimeSieve {
    private readonly composite: Uint8Array;
    private counts?: Uint32Array;

    constructor(readonly limit: number) {
        if (!Number.isSafeInteger(limit) || limit < 0 || limit > maxDensePrimeInteger) {
            throw new RankError(`primesieve bound must be between 0 and ${maxDensePrimeInteger}`, 'DomainError');
        }
        checkInterrupt('preparing prime sieve');
        const odds = Math.floor((limit + 1) / 2);
        checkpoint('preparing prime sieve', Math.ceil(odds / 8));
        this.composite = new Uint8Array(Math.ceil(odds / 8));
        if (odds) this.composite[0] = 1; // 1 is not prime.
        for (let prime = 3; prime * prime <= limit; prime += 2) {
            checkpoint('preparing prime sieve');
            if (!this.contains(prime)) continue;
            let work = 0;
            for (let index = (prime * prime - 1) / 2; index < odds; index += prime) {
                this.composite[index >>> 3] |= 1 << (index & 7);
                if (++work === 1024) { checkpoint('preparing prime sieve', work); work = 0; }
            }
            if (work) checkpoint('preparing prime sieve', work);
        }
        checkInterrupt('preparing prime sieve');
    }

    get byteLength(): number { return this.composite.byteLength; }

    /** Extra storage is allocated only by the first counting query. */
    get countIndexByteLength(): number { return this.counts?.byteLength ?? 0; }

    /** pi(value), clamped to this sieve's finite domain. */
    count(value: number): number {
        value = Math.min(value, this.limit);
        if (value < 2) return 0;
        if (!this.counts) {
            const counts = new Uint32Array(Math.floor(this.composite.length / countBlockBytes) + 1);
            let total = 0;
            for (let block = 1; block < counts.length; block++) {
                checkpoint('indexing prime counts', countBlockBytes);
                const end = block * countBlockBytes;
                for (let i = end - countBlockBytes; i < end; i++) total += 8 - bitCounts[this.composite[i]];
                counts[block] = total;
            }
            checkInterrupt('indexing prime counts');
            this.counts = counts; // Cancellation must not publish a partial index.
        }
        const odds = Math.floor((value + 1) / 2);
        const bytes = Math.floor(odds / 8);
        const block = Math.floor(bytes / countBlockBytes);
        let total = 1 + this.counts[block]; // Include 2.
        for (let i = block * countBlockBytes; i < bytes; i++) total += 8 - bitCounts[this.composite[i]];
        const remaining = odds % 8;
        if (remaining) total += remaining - bitCounts[this.composite[bytes] & ((1 << remaining) - 1)];
        checkpoint('counting primes', bytes - block * countBlockBytes + 1);
        return total;
    }

    contains(value: number): boolean {
        if (value > this.limit || value < 2 || !Number.isInteger(value)) return false;
        if (value % 2 === 0) return value === 2;
        const index = (value - 1) / 2;
        return (this.composite[index >>> 3] & (1 << (index & 7))) === 0;
    }
}

/** Bounds share the completed bitmap; membership never enumerates prime values. */
function sievePlan(sieve: DensePrimeSieve, upper: Boundary, lower?: Boundary): SequencePlan {
    const plan: SequencePlan = {
        name: 'primesieve',
        replay: 'pure',
        size: { kind: 'unknown' },
        length() {
            const last = upper.limit - (upper.inclusive ? 0n : 1n);
            const before = lower ? lower.limit - (lower.inclusive ? 1n : 0n) : 1n;
            if (last <= before) return 0n;
            // Clamp BigInt bounds before converting; arbitrarily large bounds stay exact.
            const count = (n: bigint) => n < 2n ? 0 : sieve.count(Number(n > BigInt(sieve.limit) ? BigInt(sieve.limit) : n));
            return BigInt(count(last) - count(before));
        },
        *iterate() {
            let first = lower ? lower.limit + (lower.inclusive ? 0n : 1n) : 2n;
            const last = upper.limit - (upper.inclusive ? 0n : 1n);
            if (first <= 2n && last >= 2n && sieve.contains(2)) yield 2n;
            if (first < 3n) first = 3n;
            if (first % 2n === 0n) first += 1n;
            if (first > last) return;
            for (let value = Number(first); value <= Number(last); value += 2) {
                checkpoint('reading sequence');
                if (sieve.contains(value)) yield BigInt(value);
            }
        },
        contains(value) {
            const integer = membershipInteger(value);
            return integer !== undefined && within(integer, upper) && (!lower || above(integer, lower))
                && sieve.contains(Number(integer));
        },
        withUpperBound(limit, inclusive) {
            return sievePlan(sieve, strongerUpper(upper, { limit, inclusive }), lower);
        },
        withLowerBound(limit, inclusive) {
            return sievePlan(sieve, upper, strongerLower(lower, { limit, inclusive }));
        },
    };
    registerSequenceMembership(plan);
    registerMetadataBounds(plan);
    registerStoredSequence(plan);
    return plan;
}

export function densePrimePlan(bound: RankValue): SequencePlan {
    if (typeof bound !== 'bigint') throw new RankError('primesieve expects an integer bound', 'TypeError');
    if (bound < 0n || bound > BigInt(maxDensePrimeInteger)) {
        throw new RankError(`primesieve bound must be between 0 and ${maxDensePrimeInteger}`, 'DomainError');
    }
    return sievePlan(new DensePrimeSieve(Number(bound)), { limit: bound, inclusive: true });
}
