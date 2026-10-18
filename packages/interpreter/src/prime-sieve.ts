import { checkpoint } from './interrupt.js';

// Absolute positions use exact Number arithmetic, never 32-bit coercion.
// The base sieve is capped at 2^20 (512 KiB of odd flags); larger values
// retain the arbitrary-precision primality path instead of growing sqrt(N).
export const maxSieveInteger = 2 ** 40 - 1;
const segmentOdds = 32768;

/** One bounded workspace per traversal or membership observer. No global cursor. */
export class PrimeSieve {
    private baseLimit = 0;
    private basePrimes = new Uint32Array(0);
    private readonly composite = new Uint8Array(segmentOdds / 8);
    private first = 0;
    private last = -1;

    /** The caller supplies an odd integer in [3, maxSieveInteger]. */
    contains(value: number): boolean {
        if (value < this.first || value > this.last) this.prepare(value);
        const index = (value - this.first) / 2;
        return (this.composite[index >>> 3] & (1 << (index & 7))) === 0;
    }

    private prepare(value: number): void {
        const first = 3 + Math.floor((value - 3) / (2 * segmentOdds)) * 2 * segmentOdds;
        const last = Math.min(first + 2 * (segmentOdds - 1), maxSieveInteger);
        const root = Math.floor(Math.sqrt(last));
        this.extendBase(root);
        // Do not publish a partially prepared segment if cancellation throws.
        this.first = 0;
        this.last = -1;
        this.composite.fill(0);
        for (const prime of this.basePrimes) {
            if (prime * prime > last) break;
            checkpoint('sieving primes', 1024);
            let multiple = Math.max(prime * prime, Math.ceil(first / prime) * prime);
            if (multiple % 2 === 0) multiple += prime;
            let work = 0;
            for (let index = (multiple - first) / 2; index < segmentOdds && first + 2 * index <= last; index += prime) {
                this.composite[index >>> 3] |= 1 << (index & 7);
                if (++work === 1024) { checkpoint('sieving primes', work); work = 0; }
            }
        }
        this.first = first;
        this.last = last;
    }

    private extendBase(root: number): void {
        if (root <= this.baseLimit) return;
        let limit = Math.max(256, this.baseLimit);
        while (limit < root) limit *= 2;
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
        }
        this.basePrimes = Uint32Array.from(primes);
        this.baseLimit = limit;
    }
}
