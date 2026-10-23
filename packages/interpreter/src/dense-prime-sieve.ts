import { RankError } from './errors.js';
import { checkpoint, checkInterrupt } from './interrupt.js';
import { above, within, strongerLower, strongerUpper, membershipInteger, registerMetadataBounds, type Boundary } from './sequence-bounds.js';
import { registerStoredSequence } from './stored-value.js';
import { registerSequenceMembership } from './sequence-membership.js';
import type { RankValue, SequencePlan } from './value.js';

// At most 256 MiB of odd flags; bit offsets remain below 2^31.
export const maxDensePrimeInteger = 2 ** 32 - 1;

/** Immutable, explicitly bounded sieve. One bit per odd integer, including 1. */
export class DensePrimeSieve {
    private readonly composite: Uint8Array;

    constructor(readonly limit: number) {
        if (!Number.isSafeInteger(limit) || limit < 0 || limit > maxDensePrimeInteger) {
            throw new RankError(`primesieve bound must be between 0 and ${maxDensePrimeInteger}`, 'DomainError');
        }
        checkInterrupt('preparing prime sieve');
        const odds = Math.floor((limit + 1) / 2);
        checkpoint('preparing prime sieve', Math.ceil(odds / 8));
        this.composite = new Uint8Array(Math.ceil(odds / 8));
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
