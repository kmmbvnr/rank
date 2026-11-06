import { currentDiagnostics } from '../diagnostics.js';
import { checkpoint, checkInterrupt, demandBudgetEnabled, inspectionEnabled, privateLoopPolling } from '../interrupt.js';
import { registerSequenceCompletion } from '../sequence-completion.js';
import { typedArray } from '../array-storage.js';
import { PrimeSieve, maxSieveInteger, maxPrimeRunInteger, primeSegmentSpan } from './prime-sieve.js';
import { primeMembership } from './primality.js';
import { registerSequenceMembership } from '../sequence-membership.js';
import { above, within, strongerLower, strongerUpper, membershipInteger, registerMetadataBounds, type Boundary } from '../sequence-bounds.js';
import type { SequencePlan } from './value.js';

const membershipSieveDemand = 64;
// Do not build a large sqrt(Start) table for a short take/index lookup. After
// 1024 delivered primes, a continued traversal can amortize the wider workspace.
// Measured on M5/Node 24 at Start=10^14: threshold 256 made take 1000
// ~5x slower; 1024 retains its ~23 ms path while reducing take 100000
// from ~1.65 s to ~0.26 s. Thresholds 4096/8192 delayed that benefit.
// Unknown future demand can still stop immediately after paying setup.
// The bit base is capped at 1 MiB and its prime list at about 4 MiB; values
// beyond 2^48 retain the arbitrary-precision path. No wall-clock heuristics.
const primeRunSieveDemand = 1024;

export function primePlan(boundary?: Boundary, lower?: Boundary): SequencePlan {
    let membershipSieve: PrimeSieve | undefined;
    let previousSegment: number | undefined;
    let runLength = 0;
    let penalty = 0;
    const plan: SequencePlan = {
        name: 'primes',
        replay: 'pure',
        size: boundary ? { kind: 'unknown' } : { kind: 'infinite' },
        iterate: () => primeIterator(boundary, lower),
        contains(value) {
            const integer = membershipInteger(value);
            if (integer === undefined || boundary && !within(integer, boundary) || lower && !above(integer, lower)) {
                return false;
            }
            if (integer >= 3n && integer <= BigInt(maxSieveInteger) && integer % 2n !== 0n) {
                const candidate = Number(integer);
                if (boundary) return (membershipSieve ??= new PrimeSieve()).contains(candidate);
                const segment = Math.floor((candidate - 3) / primeSegmentSpan);
                // Short runs raise the next segment's warmup, up to 64 queries;
                // long runs pay it back, down to the original two-query entry.
                // Keep the history local to this observer, without timing probes.
                if (segment === previousSegment) runLength++;
                else {
                    if (previousSegment !== undefined) {
                        penalty = Math.max(0, Math.min(membershipSieveDemand - 2,
                            penalty + membershipSieveDemand - runLength));
                    }
                    previousSegment = segment;
                    runLength = 1;
                }
                const cached = membershipSieve?.cached(candidate);
                if (cached !== undefined) return cached;
                if (runLength >= 2 + penalty) {
                    return (membershipSieve ??= new PrimeSieve()).contains(candidate);
                }
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
            return primePlan(strongerUpper(boundary, { limit, inclusive }), lower);
        },
        withLowerBound(limit, inclusive) {
            return primePlan(boundary, strongerLower(lower, { limit, inclusive }));
        },
    };
    if (boundary) registerSequenceCompletion(plan, () => {
        // Preserve observable demand. Opaque cancellation still polls the
        // ordinary prime iterator, including while a sieve segment is built.
        if (inspectionEnabled() || demandBudgetEnabled() || !privateLoopPolling()) return undefined;
        const high = boundary.limit - (boundary.inclusive ? 0n : 1n);
        const low = lower ? lower.limit + (lower.inclusive ? 0n : 1n) : 2n;
        // Small slices keep normal iteration; large copies avoid retaining
        // boxed values. Wider primes must not be truncated into Int32 cells.
        if (high > 2147483647n || high - (low < 2n ? 2n : low) < 65536n) return undefined;
        const width = 16384;
        const chunks: Int32Array[] = [];
        let cells = new Int32Array(width), used = 0, count = 0;
        for (const value of primeIterator(boundary, lower)) {
            if (used === cells.length) {
                chunks.push(cells);
                cells = new Int32Array(width);
                used = 0;
            }
            cells[used++] = Number(value);
            count++;
        }
        const result = new Int32Array(count);
        let offset = 0;
        for (const chunk of chunks) {
            checkpoint('materializing primes', chunk.length);
            result.set(chunk, offset);
            offset += chunk.length;
        }
        result.set(cells.subarray(0, used), offset);
        checkInterrupt('materializing primes');
        return typedArray(result);
    });
    registerSequenceMembership(plan);
    registerMetadataBounds(plan);
    return plan;
}

/** Compiled loops iterate `primes` with the bounds `applyBound` would plan. */
export function primeRange(start: bigint | undefined, from: boolean, end: bigint | undefined, to: boolean, reverse = false): Iterable<bigint> {
    const values = primeIterator(end === undefined ? undefined : { limit: end, inclusive: to },
        start === undefined ? undefined : { limit: start, inclusive: from });
    if (!reverse) return values;
    // A reversed finite plan consumes its bounds and values before the first
    // body iteration, just as ordinary reverse does. Observable execution is
    // declined at compiled entry, including after an earlier unguarded run.
    if (end === undefined) throw new Error('reversed prime iteration requires an upper bound');
    return [...values].reverse();
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
    let delivered = 0;
    for (; !boundary || within(candidate, boundary); candidate += 2n) {
        if (delivered >= primeRunSieveDemand && candidate <= BigInt(maxPrimeRunInteger)) {
            const end = boundary ? boundary.limit - (boundary.inclusive ? 0n : 1n) : BigInt(maxPrimeRunInteger);
            const last = Number(end < BigInt(maxPrimeRunInteger) ? end : BigInt(maxPrimeRunInteger));
            const sieve = new PrimeSieve(true);
            const diagnostics = currentDiagnostics();
            if (diagnostics) diagnostics.primeRunSieves++;
            let current = Number(candidate);
            for (; current <= last; current += 2) {
                checkpoint('reading sequence');
                if (sieve.contains(current)) yield BigInt(current);
            }
            candidate = BigInt(current);
            if (boundary && !within(candidate, boundary)) return;
        }
        checkpoint('reading sequence');
        if (primeMembership(candidate)) { delivered++; yield candidate; }
    }
}
