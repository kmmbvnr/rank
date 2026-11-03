import assert from 'node:assert/strict';
import {multiply} from '../../packages/interpreter/out/runtime/modular-power.js';

const start = performance.now();
const limit = Number(process.argv[2] || 100000000000000), mod = 982451653;
const last = Math.floor((Math.floor(Math.sqrt(8 * limit + 9)) - 3) / 2);
const len = limit - last * (last + 3) / 2 + 1, first = last + 3 - len;
const mul = (a, b) => multiply(a % mod, b % mod, mod);
let fact = 2, weighted = 1, prefix = 1, prefixFact = 2, extra = 0, answer = Math.min(limit, 1);
for (let m = 1; m <= last; m++) {
    extra = mul(m * (m + 3) / 2, fact);
    weighted = (mul(m + 2, weighted) + fact) % mod;
    fact = mul(fact, m + 2);
    if (m === first - 3) { prefix = weighted; prefixFact = fact; }
    answer = (answer + mul(m, weighted) + extra) % mod;
}
if (len <= last) {
    let base = prefixFact, inv = 1;
    for (let e = mod - 2; e; e >>>= 1, base = mul(base, base)) if (e & 1) inv = mul(inv, base);
    const missing = mul(last, mul(mul(prefix, inv), fact));
    answer = (answer - missing + mod) % mod;
}
if (len !== last + 2) answer = (answer - extra + mod) % mod;
if (limit === 100000000000000) assert.equal(answer, 334420941);
console.log(JSON.stringify({variant: 'native', limit, answer, ms: performance.now() - start,
    rssMiB: process.resourceUsage().maxRSS / 1024}));
