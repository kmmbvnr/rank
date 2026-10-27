// Independent phi calculation by counting coprime integers, without a sieve.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { Interpreter } = await import(pathToFileURL(resolve(process.argv[2] ?? 'packages/interpreter/out/index.js')));
const source = readFileSync(new URL('../../demos/euler/214_totientchains.ra', import.meta.url), 'utf8');
function gcd(a, b) {
    while (b) [a, b] = [b, a % b];
    return a;
}
function oracle(limit, length) {
    let total = 0;
    for (let p = 2; p < limit; p++) {
        let prime = true;
        for (let d = 2; d * d <= p; d++) if (p % d === 0) { prime = false; break; }
        if (!prime) continue;
        let n = p, terms = 1;
        while (n > 1) {
            let phi = 0;
            for (let k = 1; k <= n; k++) if (gcd(k, n) === 1) phi++;
            n = phi;
            terms++;
        }
        if (terms === length) total += p;
    }
    return String(total);
}
let checks = 0;
for (const limit of [0, 1, 2, 3, 10, 31, 100, 257]) {
    for (const length of [2, 3, 4, 5, 7, 10]) {
        const expected = oracle(limit, length);
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(source.replace('option Limit integer = 40000000', `option Limit integer = ${limit}`)
                    .replace('option Len integer = 25', `option Len integer = ${length}`));
                assert.equal(String(runtime.variables.get('Answer')), expected,
                    `Limit=${limit} Len=${length} compilation=${compilation}`);
                checks++;
            } finally { runtime.dispose(); }
        }
    }
}
console.log(JSON.stringify({ checks, failures: [] }));
