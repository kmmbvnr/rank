import { RankError } from '../errors.js';
import { sequence, windowValue } from '../sequence.js';
import { isRankArray, isRankQueue, isRankSequence, isRankSet, type RankValue, type SequencePlan, type SequencePredicate } from '../value.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

interface Boundary {
    readonly limit: bigint;
    readonly inclusive: boolean;
}

export const sequencesModule: RuntimeModule = {
    fibonacci: () => sequence(fibonacciPlan()),
    primes: () => sequence(primePlan()),
    len: () => native('len', 1, arguments_ => lengthOf(arguments_[0])),
    window: () => native('window', 2, arguments_ => windowValue(arguments_[0], arguments_[1])),
};

function lengthOf(value: RankValue): bigint {
    if (typeof value === 'string') return BigInt([...value].length);
    if (isRankArray(value)) return BigInt(value.shape[0] ?? 0);
    if (isRankQueue(value)) return BigInt(value.items.length);
    if (isRankSet(value)) return BigInt(value.entries.size);
    if (!isRankSequence(value)) throw new RankError('len expects text or a collection');
    if (value.plan.size.kind === 'infinite') {
        throw new RankError('len requires a finite sequence');
    }
    if (value.plan.size.kind === 'exact') return value.plan.size.value;
    let length = 0n;
    for (const _ of value.plan.iterate()) length += 1n;
    return length;
}

function fibonacciPlan(boundary?: Boundary, evenOnly = false): SequencePlan {
    return {
        name: evenOnly ? 'even fibonacci' : 'fibonacci',
        size: boundary
            ? { kind: 'exact', value: fibonacciSize(boundary, evenOnly) }
            : { kind: 'infinite' },
        *iterate() {
            let current = evenOnly ? 2n : 1n;
            let next = evenOnly ? 8n : 2n;
            while (!boundary || within(current, boundary)) {
                yield current;
                [current, next] = evenOnly
                    ? [next, 4n * next + current]
                    : [next, current + next];
            }
        },
        withUpperBound(limit, inclusive) {
            return fibonacciPlan({ limit, inclusive }, evenOnly);
        },
        withFilter(predicate: SequencePredicate) {
            if (predicate.optimizationKey === 'even') return fibonacciPlan(boundary, true);
            return undefined;
        },
    };
}

function within(value: bigint, boundary: Boundary): boolean {
    return boundary.inclusive ? value <= boundary.limit : value < boundary.limit;
}

function fibonacciSize(boundary: Boundary, evenOnly: boolean): bigint {
    let count = 0n;
    let current = evenOnly ? 2n : 1n;
    let next = evenOnly ? 8n : 2n;
    while (within(current, boundary)) {
        count += 1n;
        [current, next] = evenOnly
            ? [next, 4n * next + current]
            : [next, current + next];
    }
    return count;
}

function primePlan(boundary?: Boundary): SequencePlan {
    return {
        name: 'primes',
        size: boundary ? { kind: 'unknown' } : { kind: 'infinite' },
        iterate: () => primeIterator(boundary),
        at(index) {
            let current = 0n;
            for (const value of primeIterator(boundary)) {
                if (current === index) return value;
                current += 1n;
            }
            return undefined;
        },
        withUpperBound(limit, inclusive) {
            return primePlan({ limit, inclusive });
        },
    };
}

function* primeIterator(boundary?: Boundary): IterableIterator<bigint> {
    const found: bigint[] = [];
    for (let candidate = 2n; !boundary || within(candidate, boundary); candidate += 1n) {
        if (isPrime(candidate, found)) {
            found.push(candidate);
            yield candidate;
        }
    }
}

function isPrime(candidate: bigint, smallerPrimes: readonly bigint[]): boolean {
    for (const prime of smallerPrimes) {
        if (prime * prime > candidate) return true;
        if (candidate % prime === 0n) return false;
    }
    return true;
}
