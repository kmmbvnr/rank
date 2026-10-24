import { describe, expect, it } from 'vitest';
import { safeIntegerModularPower } from '../src/modular-power.js';
import { modularPower } from '../src/primality.js';

describe('exact Number modular power', () => {
    it('corrects floating quotients rounded in either direction', () => {
        // These squares make the estimated quotient one too high / too low.
        expect(safeIntegerModularPower(1073643523, 2, 1073676290)).toBe(1073676289);
        expect(safeIntegerModularPower(1073250360, 2, 1073283121)).toBe(0);
    });

    it('matches BigInt at multiplication and exponent boundaries', () => {
        for (const modulus of [1, 2, 3, 2 ** 26 - 1, 2 ** 26 + 1, 94906265,
            135707531, 2 ** 29 + 1, 2 ** 30 - 1, 2 ** 30]) {
            for (const base of [0, 1, modulus - 1, -modulus - 1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
                for (const exponent of [0, 1, 2, 3, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, Number.MAX_SAFE_INTEGER]) {
                    expect(BigInt(safeIntegerModularPower(base, exponent, modulus)))
                        .toBe(modularPower(BigInt(base), BigInt(exponent), BigInt(modulus)));
                }
            }
        }
    });

    it('matches a deterministic randomized BigInt oracle', () => {
        let seed = 433;
        const next = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        for (let sample = 0; sample < 4096; sample++) {
            const modulus = 1 + next() % (2 ** 30);
            const base = (next() - 2 ** 31) * 1048576 + next() % 1048576;
            const exponent = sample % 16 === 0 ? next() * 1048576 + next() % 1048576 : next();
            expect(BigInt(safeIntegerModularPower(base, exponent, modulus)))
                .toBe(modularPower(BigInt(base), BigInt(exponent), BigInt(modulus)));
        }
    });
});
