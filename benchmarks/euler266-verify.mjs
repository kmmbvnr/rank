import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// Independent exhaustive subset enumeration: no meet-in-the-middle or sorted search.
function oracle(limit) {
    const primes = [];
    for (let p = 2; p < limit; p++) {
        if (!primes.some(q => p % q === 0)) primes.push(p);
    }
    const total = primes.reduce((x, p) => x * BigInt(p), 1n);
    let divisors = [1n];
    for (const p of primes) divisors = divisors.concat(divisors.map(x => x * BigInt(p)));
    return divisors.reduce((best, x) => x * x <= total && x > best ? x : best, 0n);
}

for (const limit of [3, 5, 10, 20, 30, 40, 50]) {
    const expected = String(oracle(limit));
    for (const mode of ['compiled', 'reference']) {
        for (const variant of ['original', 'search', 'walk', 'shipping']) {
            const result = JSON.parse(execFileSync(process.execPath, [
                fileURLToPath(new URL('./euler266-investigation.mjs', import.meta.url)),
                mode, String(limit), variant,
            ], { encoding: 'utf8' }));
            assert.equal(result.best, expected, JSON.stringify({ limit, mode, variant }));
            console.log(JSON.stringify({ limit, mode, variant, best: result.best }));
        }
    }
}
