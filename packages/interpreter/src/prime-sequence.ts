import { checkpoint } from './interrupt.js';
import { PrimeSieve, maxSieveInteger, primeSegmentSpan } from './prime-sieve.js';
import { primeMembership } from './primality.js';
import { registerSequenceMembership } from './sequence-membership.js';
import { above, within, strongerLower, membershipInteger, type Boundary } from './sequence-bounds.js';
import type { SequencePlan } from './value.js';

export function primePlan(boundary?: Boundary, lower?: Boundary): SequencePlan {
    let membershipSieve: PrimeSieve | undefined;
    let previousSegment: number | undefined;
    const plan: SequencePlan = {
        name: 'primes',
        replay: 'pure',
        replCursor: true,
        size: boundary ? { kind: 'unknown' } : { kind: 'infinite' },
        iterate: () => primeIterator(boundary, lower),
        contains(value) {
            const integer = membershipInteger(value);
            if (integer === undefined || boundary && !within(integer, boundary) || lower && !above(integer, lower)) {
                return false;
            }
            if (integer >= 3n && integer <= BigInt(maxSieveInteger) && integer % 2n !== 0n) {
                const candidate = Number(integer);
                const segment = Math.floor((candidate - 3) / primeSegmentSpan);
                // Repeated local queries amortize marking a segment. Isolated
                // unbounded queries keep trial division / Miller-Rabin.
                const local = segment === previousSegment;
                previousSegment = segment;
                if (boundary || local) return (membershipSieve ??= new PrimeSieve()).contains(candidate);
            }
            return primeMembership(integer);
        },
        at(index) {
            let current = 0n;
            for (const value of primeIterator(boundary, lower)) {
                if (current === index) return value;
                current += 1n;
            }
            return undefined;
        },
        withUpperBound(limit, inclusive) {
            return primePlan({ limit, inclusive }, lower);
        },
        withLowerBound(limit, inclusive) {
            return primePlan(boundary, strongerLower(lower, { limit, inclusive }));
        },
    };
    registerSequenceMembership(plan);
    return plan;
}

function* primeIterator(
    boundary?: Boundary,
    lower?: Boundary,
): IterableIterator<bigint> {
    let candidate = lower ? lower.limit + (lower.inclusive ? 0n : 1n) : 2n;
    if (candidate <= 2n) {
        if (!boundary || within(2n, boundary)) yield 2n;
        candidate = 3n;
    }
    if (candidate % 2n === 0n) candidate += 1n;
    // Work only toward the next demanded segment, even with a huge upper bound.
    // Numeric candidates and the bounded base table stay exact in this region.
    if (candidate <= BigInt(maxSieveInteger)) {
        const end = boundary
            ? boundary.limit - (boundary.inclusive ? 0n : 1n)
            : BigInt(maxSieveInteger);
        const last = Number(end < BigInt(maxSieveInteger) ? end : BigInt(maxSieveInteger));
        const sieve = new PrimeSieve();
        let current = Number(candidate);
        for (; current <= last; current += 2) {
            checkpoint('reading sequence');
            if (sieve.contains(current)) yield BigInt(current);
        }
        candidate = BigInt(current);
    }
    for (; !boundary || within(candidate, boundary); candidate += 2n) {
        checkpoint('reading sequence');
        if (primeMembership(candidate)) yield candidate;
    }
}
