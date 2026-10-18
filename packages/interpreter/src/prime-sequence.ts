import { checkpoint } from './interrupt.js';
import { probablePrime } from './primality.js';
import { registerSequenceMembership } from './sequence-membership.js';
import { above, within, strongerLower, membershipInteger, type Boundary } from './sequence-bounds.js';
import type { SequencePlan } from './value.js';

export function primePlan(boundary?: Boundary, lower?: Boundary): SequencePlan {
    const plan: SequencePlan = {
        name: 'primes',
        size: boundary ? { kind: 'unknown' } : { kind: 'infinite' },
        iterate: () => primeIterator(boundary, lower),
        contains(value) {
            const integer = membershipInteger(value);
            return integer !== undefined
                && (!boundary || within(integer, boundary))
                && (!lower || above(integer, lower))
                && primeMembership(integer);
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

// Below 4096^2 trial division by the primes under 4096 is exact and cheaper than
// Miller-Rabin. Larger values only screen out small factors before it, so no
// table grows toward the square root of the value tested.
const trialLimit = 4096;
const trialPrimes = primesBelow(trialLimit);
const screenPrimes = trialPrimes.filter(prime => prime < 256n);
const trialSquare = BigInt(trialLimit) ** 2n;

function primesBelow(limit: number): bigint[] {
    const composite = new Uint8Array(limit);
    const primes: bigint[] = [];
    for (let candidate = 2; candidate < limit; candidate += 1) {
        if (composite[candidate]) continue;
        primes.push(BigInt(candidate));
        for (let multiple = candidate * candidate; multiple < limit; multiple += candidate) {
            composite[multiple] = 1;
        }
    }
    return primes;
}

function primeMembership(value: bigint): boolean {
    if (value < 2n) return false;
    for (const prime of value < trialSquare ? trialPrimes : screenPrimes) {
        if (prime * prime > value) return true;
        if (value % prime === 0n) return value === prime;
    }
    return probablePrime(value);
}

function* primeIterator(
    boundary?: Boundary,
    lower?: Boundary,
): IterableIterator<bigint> {
    // Each candidate is tested on its own. Keeping every prime yielded instead
    // would grow without end on a search that never stops.
    let candidate = lower ? lower.limit + (lower.inclusive ? 0n : 1n) : 2n;
    if (candidate <= 2n) {
        if (!boundary || within(2n, boundary)) yield 2n;
        candidate = 3n;
    }
    if (candidate % 2n === 0n) candidate += 1n;
    for (; !boundary || within(candidate, boundary); candidate += 2n) {
        checkpoint('reading sequence');
        if (primeMembership(candidate)) yield candidate;
    }
}
