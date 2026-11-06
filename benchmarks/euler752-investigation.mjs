// node benchmarks/euler752-investigation.mjs [limit] [--reference-only]
// Reference strips prime factors sequentially and lifts each order. Rank
// instead tests every candidate independently in one matrix batch.
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { runProgram } from '@arrrank/common';

const limit = Number(process.argv[2] ?? 1000);
function powerIsOne(exponent, modulus) {
    let real = 1, root = 0, baseReal = 1, baseRoot = 1;
    while (exponent > 0) {
        if (exponent % 2) {
            const next = (real * baseReal + 7 * root * baseRoot) % modulus;
            root = (real * baseRoot + root * baseReal) % modulus;
            real = next;
        }
        const next = (baseReal * baseReal + 7 * baseRoot * baseRoot) % modulus;
        baseRoot = 2 * baseReal * baseRoot % modulus;
        baseReal = next;
        exponent = Math.floor(exponent / 2);
    }
    return real === 1 && root === 0;
}
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
function reference(limit) {
    const sieve = Int32Array.from({ length: limit + 2 }, (_, i) => i);
    for (let p = 2; p * p <= limit + 1; p++) if (sieve[p] === p) {
        for (let n = p * p; n <= limit + 1; n += p) if (sieve[n] === n) sieve[n] = p;
    }
    function factors(n) {
        const result = [];
        while (n > 1) {
            const p = sieve[n]; result.push(p);
            while (n % p === 0) n /= p;
        }
        return result;
    }
    const orders = new Float64Array(limit + 1);
    for (let p = 5; p <= limit; p++) if (sieve[p] === p) {
        let order = p === 7 ? 7 : p * p - 1;
        if (p !== 7) for (const q of new Set([...factors(p - 1), ...factors(p + 1)])) {
            while (order % q === 0 && powerIsOne(order / q, p)) order /= q;
        }
        let modulus = p; orders[modulus] = order;
        while (modulus * p <= limit) {
            modulus *= p;
            if (!powerIsOne(order, modulus)) order *= p;
            orders[modulus] = order;
        }
    }
    let answer = 0;
    for (let n = 5; n <= limit; n++) if (gcd(n, 6) === 1) {
        let rest = n, period = 1;
        while (rest > 1) {
            const p = sieve[rest]; let modulus = 1;
            while (rest % p === 0) { rest /= p; modulus *= p; }
            period = period / gcd(period, orders[modulus]) * orders[modulus];
        }
        answer += period;
    }
    return String(answer);
}
if (!Number.isInteger(limit) || limit < 2 || limit > 1000000) {
    throw new Error('Oracle is validated for integer limits from 2 through 1000000');
}
const expected = reference(limit);
const result = { limit, expected, node: process.version, arch: process.arch };
if (!process.argv.includes('--reference-only')) {
    const source = fs.readFileSync(new URL('../demos/euler/752_powers.ra', import.meta.url), 'utf8');
    const output = [], start = performance.now();
    runProgram(source, value => output.push(value), { args: ['--limit', String(limit)] });
    result.rankMs = performance.now() - start;
    result.actual = output.at(-1);
    result.peakRssBytes = process.resourceUsage().maxRSS * 1024;
    if (result.actual !== expected) throw new Error(JSON.stringify(result));
}
console.log(JSON.stringify(result, null, 2));
