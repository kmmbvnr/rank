import { checkpoint, checkInterrupt } from '../interrupt.js';

// Absolute positions use exact Number arithmetic, never 32-bit coercion.
// Ordinary observers cap the base at 2^20 (512 KiB of odd flags). Long
// traversals may opt into the separate bounded workspace below.
export const maxSieveInteger = 2 ** 40 - 1;
export const primeSegmentSpan = 65536;
// Long traversals may amortize a larger, still bounded base (2^24).
// Membership and short reads retain the original 2^20 base/64K segments.
export const maxPrimeRunInteger = 2 ** 48 - 1;
const primeRunSegmentSpan = 2 ** 20;
const initialOdds = 128;

/** One bounded workspace per traversal or membership observer. No global cursor. */
export class PrimeSieve {
    private baseLimit = 0;
    private basePrimes = new Uint32Array(0);
    private readonly composite: Uint8Array;
    private readonly segmentOdds: number;
    private readonly maximum: number;

    private first = 0;
    private last = -1;

    constructor(wide = false) {
        this.maximum = wide ? maxPrimeRunInteger : maxSieveInteger;
        this.segmentOdds = (wide ? primeRunSegmentSpan : primeSegmentSpan) / 2;
        this.composite = new Uint8Array(this.segmentOdds / 8);
    }

    /** Read an already prepared odd candidate without extending the workspace. */
    cached(value: number): boolean | undefined {
        if (value < this.first || value > this.last) return undefined;
        const index = (value - this.first) / 2;
        return (this.composite[index >>> 3] & (1 << (index & 7))) === 0;
    }

    /** The caller supplies an odd integer within this workspace's bound. */
    contains(value: number): boolean {
        if (value < this.first || value > this.last) this.prepare(value);
        const index = (value - this.first) / 2;
        return (this.composite[index >>> 3] & (1 << (index & 7))) === 0;
    }

    private prepare(value: number): void {
        const segmentOdds = this.segmentOdds;
        const first = 3 + Math.floor((value - 3) / (2 * segmentOdds)) * 2 * segmentOdds;
        // Grow the first segment with demand instead of marking a large block
        // for a short prefix. Later segments use the regular workspace.
        let odds = initialOdds;
        while (odds < segmentOdds && value >= 3 + 2 * odds) odds *= 2;
        const last = Math.min(first + 2 * (odds - 1), this.maximum);
        const root = Math.floor(Math.sqrt(last));
        this.extendBase(root);
        // Do not publish a partially prepared segment if cancellation throws.
        this.first = 0;
        this.last = -1;
        const bytes = Math.ceil(odds / 8);
        checkInterrupt('sieving primes');
        checkpoint('clearing prime segment', bytes);
        this.composite.fill(0, 0, bytes);
        for (const prime of this.basePrimes) {
            if (prime * prime > last) break;
            checkpoint('sieving primes');
            checkInterrupt('sieving primes');
            let multiple = Math.max(prime * prime, Math.ceil(first / prime) * prime);
            if (multiple % 2 === 0) multiple += prime;
            let work = 0;
            for (let index = (multiple - first) / 2; index < odds && first + 2 * index <= last; index += prime) {
                this.composite[index >>> 3] |= 1 << (index & 7);
                if (++work === 1024) { checkpoint('sieving primes', work); work = 0; }
            }
            if (work) checkpoint('sieving primes', work);
        }
        this.first = first;
        this.last = last;
    }

    private extendBase(root: number): void {
        if (root <= this.baseLimit) return;
        let limit = Math.max(256, this.baseLimit);
        while (limit < root) limit *= 2;
        checkpoint('preparing prime sieve', limit / 2);
        // Keep the established single-pass byte sieve for small observers.
        // Bit packing and two-pass typed output pay off only on the wide base.
        if (this.maximum === maxSieveInteger) {
            const composite = new Uint8Array(limit / 2), primes: number[] = [];
            for (let prime = 3; prime <= limit; prime += 2) {
                checkpoint('preparing prime sieve');
                if (composite[(prime - 1) / 2]) continue;
                primes.push(prime);
                let work = 0;
                for (let multiple = prime * prime; multiple <= limit; multiple += 2 * prime) {
                    composite[(multiple - 1) / 2] = 1;
                    if (++work === 1024) { checkpoint('preparing prime sieve', work); work = 0; }
                }
                if (work) checkpoint('preparing prime sieve', work);
            }
            this.basePrimes = Uint32Array.from(primes);
            this.baseLimit = limit;
            return;
        }
        const composite = new Uint8Array(Math.ceil(limit / 16));
        const marked = (prime: number) => {
            const index = (prime - 1) / 2;
            return (composite[index >>> 3] & (1 << (index & 7))) !== 0;
        };
        for (let prime = 3; prime * prime <= limit; prime += 2) {
            checkpoint('preparing prime sieve');
            if (marked(prime)) continue;
            let work = 0;
            for (let multiple = prime * prime; multiple <= limit; multiple += 2 * prime) {
                const index = (multiple - 1) / 2;
                composite[index >>> 3] |= 1 << (index & 7);
                if (++work === 1024) { checkpoint('preparing prime sieve', work); work = 0; }
            }
            if (work) checkpoint('preparing prime sieve', work);
        }
        let count = 0;
        for (let prime = 3; prime <= limit; prime += 2) {
            checkpoint('preparing prime sieve');
            if (!marked(prime)) count++;
        }
        const primes = new Uint32Array(count);
        let next = 0;
        for (let prime = 3; prime <= limit; prime += 2) {
            checkpoint('preparing prime sieve');
            if (!marked(prime)) primes[next++] = prime;
        }
        this.basePrimes = primes;
        this.baseLimit = limit;
    }
}
