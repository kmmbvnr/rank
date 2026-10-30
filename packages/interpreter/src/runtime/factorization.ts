import { checkpoint } from '../interrupt.js';
import { greatestCommonDivisor } from './integer-gcd.js';
import { probablePrime } from './primality.js';
import { integerSquareRoot } from './integer-square-root.js';

// The retained table is at most 4 MiB, independent of arbitrary-precision inputs.
export const maxFactorTableInteger = 2 ** 20 - 1;
const maxTableValue = BigInt(maxFactorTableInteger);

/** Reused by one interpreter's number operations; no global table or cursor. */
export class Factorizer {
    private smallest = new Uint32Array(0);

    /** An owned snapshot: caller writes cannot change the shared sieve. */
    smallestFactors(limit: number): Int32Array {
        this.prepare(limit);
        checkpoint('preparing factor table', limit + 1);
        return new Int32Array(this.smallest.subarray(0, limit + 1));
    }

    *factors(value: bigint): IterableIterator<bigint> {
        let remaining = value;
        for (let divisor = 2n; remaining > 1n; divisor += divisor === 2n ? 1n : 2n) {
            if (remaining <= maxTableValue) {
                yield* this.bounded(Number(remaining));
                return;
            }
            // Stream small factors first, including for arbitrary-precision
            // inputs. Only the remaining 64-bit tail needs sorting.
            if (divisor >= 41n && remaining < (1n << 64n)) {
                const tail = [...this.split64(remaining)];
                tail.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
                yield* tail;
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

    private *split64(value: bigint): IterableIterator<bigint> {
        if (value <= maxTableValue) { yield* this.bounded(Number(value)); return; }
        // Factoring a square's root reuses the bounded table across adjacent
        // inputs instead of searching for the same prime twice with Brent.
        const root = integerSquareRoot(value);
        if (root * root === value) {
            for (const prime of this.split64(root)) { yield prime; yield prime; }
            return;
        }
        // The existing Miller-Rabin witnesses are deterministic below 2^64.
        if (probablePrime(value)) { yield value; return; }
        const divisor = brentFactor(value);
        yield* this.split64(divisor);
        yield* this.split64(value / divisor);
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

/** Deterministic retries of Pollard-Brent; every returned divisor is exact. */
function brentFactor(value: bigint): bigint {
    for (let constant = 1n; ; constant++) {
        let y = 2n, x = 0n, saved = 0n, divisor = 1n;
        let radius = 1;
        const advance = (n: bigint): bigint => {
            checkpoint('searching factors');
            return (n * n + constant) % value;
        };
        while (divisor === 1n && radius <= 1048576) {
            x = y;
            for (let i = 0; i < radius; i++) y = advance(y);
            for (let start = 0; start < radius && divisor === 1n; start += 64) {
                saved = y;
                let product = 1n;
                for (let i = 0; i < Math.min(64, radius - start); i++) {
                    y = advance(y);
                    product = product * (x > y ? x - y : y - x) % value;
                }
                divisor = greatestCommonDivisor(product, value);
            }
            radius *= 2;
        }
        if (divisor === value) {
            do {
                saved = advance(saved);
                divisor = greatestCommonDivisor(x > saved ? x - saved : saved - x, value);
            } while (divisor === 1n);
        }
        if (divisor > 1n && divisor < value) return divisor;
    }
}
