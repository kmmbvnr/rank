import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { run } from './support.js';

// Independent sieve checks both primes and composites, including prime squares.
function sieve(limit: number): boolean[] {
    const prime = Array<boolean>(limit + 1).fill(true);
    prime[0] = prime[1] = false;
    for (let p = 2; p * p <= limit; p++) {
        if (prime[p]) for (let n = p * p; n <= limit; n += p) prime[n] = false;
    }
    return prime;
}

describe('prime membership', () => {
    it('matches a sieve in ascending and descending queries', () => {
        const runtime = new Interpreter();
        const expected = sieve(20000);
        runtime.execute('use sequences');
        const value = runtime.execute('(0 to 20000) copy in primes');
        expect(isRankArray(value!)).toBe(true);
        if (value && isRankArray(value)) expect(value.items).toEqual(expected);
        const reverse = runtime.execute('(20000 to 0 by -1) copy in primes');
        if (reverse && isRankArray(reverse)) expect(reverse.items).toEqual([...expected].reverse());
        else throw new Error('expected array');
    });

    it('preserves numeric membership and source boundaries', () => {
        expect(run('use sequences\n(array -7 0 1 2 3 5 31 37 49 961 1369) in primes'))
            .toBe('false false false true true true true true false false false');
        expect(run('use sequences\n(array 2.0 3.5 31.0) in primes'))
            .toBe('true false true');
        expect(run('use sequences\n(array 29 31 37 41) in (primes from 31 till 41)'))
            .toBe('false true true false');
    });

    it('matches a sieve across the trial division limit', () => {
        // 4096^2 is where trial division hands over to Miller-Rabin.
        const runtime = new Interpreter();
        const expected = sieve(16_800_000).slice(16_750_000);
        runtime.execute('use sequences');
        const value = runtime.execute('(16750000 to 16800000) copy in primes');
        if (value && isRankArray(value)) expect(value.items).toEqual(expected);
        else throw new Error('expected array');
    });

    it('rejects strong pseudoprimes and squares of primes', () => {
        expect(run(`use sequences
(array 561 2047 1373653 25326001 3215031751 4759123141 3825123056546413051) in primes`))
            .toBe('false false false false false false false');
        // The smallest strong pseudoprimes to the first 12 and 13 prime bases.
        expect(run(`use sequences
(array 318665857834031151167461 3317044064679887385961981) in primes`))
            .toBe('false false');
        expect(run('use sequences\n(array 16769023 (2 ** 61 - 1) ** 2) in primes'))
            .toBe('false false');
    });

    it('decides large values on both sides of 2^53 and 2^64', () => {
        expect(run(`use sequences
(array 9007199254740881 (2 ** 53 - 1) (2 ** 53 + 1)) in primes`))
            .toBe('true false false');
        expect(run(`use sequences
(array (10 ** 18 + 1) (10 ** 18 + 3) (10 ** 18 + 9)) in primes`))
            .toBe('false true true');
        expect(run(`use sequences
(array (2 ** 64 + 13) (2 ** 89 - 1) (2 ** 127 - 1) (2 ** 127 + 1)) in primes`))
            .toBe('true true true false');
        expect(run('use sequences\nprimes from 10 ** 18 take 2'))
            .toBe('1000000000000000003 1000000000000000009');
    });

    it('decides large primes without a divisor table growing toward their root', () => {
        // Trial division up to sqrt(N) ran for minutes and kept every divisor.
        const moduleUrl = new URL('../out/index.js', import.meta.url).href;
        const script = `
            import { Interpreter } from ${JSON.stringify(moduleUrl)};
            const runtime = new Interpreter();
            runtime.execute('use sequences');
            for (const value of [10n ** 18n + 9n, 2n ** 64n + 13n, 2n ** 127n - 1n]) {
                runtime.variables.set('N', value);
                if (runtime.execute('N in primes') !== true) process.exit(1);
            }
        `;
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
            timeout: 5000, encoding: 'utf8',
        });
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
    });

    it('rejects huge small-factor composites quickly', () => {
        // A subprocess gives a hard deadline if eager sqrt(N) extension regresses.
        // Fresh module state also proves that no earlier query warmed the list.
        const moduleUrl = new URL('../out/index.js', import.meta.url).href;
        const script = `
            import { Interpreter } from ${JSON.stringify(moduleUrl)};
            const runtime = new Interpreter();
            runtime.execute('use sequences');
            for (const factor of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n]) {
                runtime.variables.set('N', factor ** 80n);
                if (runtime.execute('N in primes') !== false) process.exit(1);
            }
        `;
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
            timeout: 5000, encoding: 'utf8',
        });
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
    });
});
