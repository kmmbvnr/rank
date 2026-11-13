import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/715_sextupletnorms.ra', import.meta.url), 'utf8');

// Independent multiplicative sieve, without Lucy tables or quotient ranges.
function oracle(limit: number, modulus: bigint) {
    const factors = new Int32Array(limit + 1);
    for (let prime = 2; prime <= limit; prime++) {
        if (factors[prime]) continue;
        for (let value = prime; value <= limit; value += prime) factors[value] = prime;
    }
    let total = 1n;
    for (let value = 2; value <= limit; value++) {
        let rest = value, term = 1n;
        while (rest > 1) {
            const prime = factors[rest], cube = BigInt(prime) ** 3n;
            let power = 1n;
            do { rest /= prime; power *= cube; } while (rest % prime === 0);
            const character = prime === 2 ? 0n : prime % 4 === 1 ? 1n : -1n;
            term = term * (power - character * (power / cube)) % modulus;
        }
        total = (total + term) % modulus;
    }
    return total % modulus;
}
function run(limit: number, prime: bigint, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source
            .replace('arg Limit integer = 10 ** 12', `Limit = ${limit}`)
            .replace('arg Prime integer = 1000000007', `Prime = ${prime}`)));
        return { answer: answerOf(runtime), diagnostics };
    } finally { runtime.dispose(); }
}

describe('Euler 715 modular Lucy tables', () => {
    it.each([1, 2, 3, 4, 8, 9, 10, 25, 27, 49, 64, 125, 999, 10000])(
        'matches an independent multiplicative sieve at %s', limit => {
            const expected = oracle(limit, 1000000007n);
            expect(run(limit, 1000000007n, true).answer).toBe(expected);
            expect(run(limit, 1000000007n, false).answer).toBe(expected);
        });
    it.each([1n, 97n, 1073741824n, 1073741825n])('retains modulus boundaries at %s', prime => {
        const expected = oracle(1000, prime);
        expect(run(1000, prime, true).answer).toBe(expected);
        expect(run(1000, prime, false).answer).toBe(expected);
    });
    it('keeps all three default-modulus passes in Number without replay', () => {
        const result = run(100000, 1000000007n, true);
        expect(result.answer).toBe(157612967n);
        expect(result.diagnostics.numberLoops).toBe(3);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });
});
