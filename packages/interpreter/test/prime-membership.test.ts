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

describe('prime membership trial division', () => {
    it('matches a sieve through cache growth and repeated descending queries', () => {
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
        expect(run('use sequences\n(array 29 31 37 41) in ((primes from 31) until 41)'))
            .toBe('false true true false');
    });

    it('rejects huge small-factor composites before extending divisors', () => {
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
