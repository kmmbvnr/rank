import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { Interpreter } = await import(pathToFileURL(resolve(process.argv[2] ?? 'packages/interpreter/out/index.js')));
const captured = JSON.parse(readFileSync(new URL('../baselines/2026-10-27-euler216-investigation.json', import.meta.url), 'utf8'));
const sources = [captured.originalSource, readFileSync(new URL('../../demos/euler/216_primality.ra', import.meta.url), 'utf8'),
    ...['residual', 'guarded', 'split', 'segmented'].map(name => readFileSync(new URL(`./euler216-${name}.ra`, import.meta.url), 'utf8'))];
// Independent direct trial division: no runtime prime membership or factor sieve.
function prime(n) {
    if (n < 2) return false;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
    return true;
}
let checks = 0;
for (const limit of [-3, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 19, 31, 47, 64, 100, 127, 200, 257, 511, 1000, 2000, 4096]) {
    let expected = 0;
    for (let n = 2; n <= limit; n++) if (prime(2 * n * n - 1)) expected++;
    for (const [variant, source] of sources.entries()) for (const compilation of [false, true]) {
        if (limit < 0 && variant > 1) continue;
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source.replace(/arg Limit integer = \d+/, `arg Limit integer = ${limit}`));
            assert.equal(runtime.variables.get('Answer'), BigInt(expected), `limit=${limit}, compiled=${compilation}`);
            checks++;
        } finally { runtime.dispose(); }
    }
}
console.log(JSON.stringify({ checks, passed: true }));
