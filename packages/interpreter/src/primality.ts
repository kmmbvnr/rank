import { checkpoint } from './interrupt.js';

/** `base ** exponent mod modulus` for a nonnegative exponent and a positive modulus. */
export function modularPower(base: bigint, exponent: bigint, modulus: bigint): bigint {
    let factor = ((base % modulus) + modulus) % modulus;
    let power = exponent;
    let result = 1n % modulus;
    while (power > 0n) {
        checkpoint('computing numbers', 1024);
        if (power % 2n === 1n) result = result * factor % modulus;
        factor = factor * factor % modulus;
        power /= 2n;
    }
    return result;
}

// These seven witnesses prove primality below 2^64. The first 13 primes prove
// it below 3317044064679887385961981 (about 3.3e24), which itself fools all 13
// and is caught by 43. Above it a composite passes with probability under 4^-14.
const witnesses64 = [2n, 325n, 9375n, 28178n, 450775n, 9780504n, 1795265022n];
const primeWitnesses = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n];

/** Deterministic Miller-Rabin through about 3.3e24; probable-prime above it. */
export function probablePrime(value: bigint): boolean {
    if (value < 2n) return false;
    for (const prime of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
        checkpoint('computing numbers');
        if (value === prime) return true;
        if (value % prime === 0n) return false;
    }
    let odd = value - 1n;
    let shifts = 0;
    while (odd % 2n === 0n) {
        checkpoint('computing numbers');
        odd /= 2n;
        shifts += 1;
    }
    for (const witness of value < 1n << 64n ? witnesses64 : primeWitnesses) {
        checkpoint('computing numbers');
        const base = witness % value;
        if (base === 0n) continue;
        let power = modularPower(base, odd, value);
        if (power === 1n || power === value - 1n) continue;
        let composite = true;
        for (let step = 1; step < shifts; step += 1) {
            checkpoint('computing numbers');
            power = power * power % value;
            if (power === value - 1n) {
                composite = false;
                break;
            }
        }
        if (composite) return false;
    }
    return true;
}
