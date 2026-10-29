// Check every cached length against direct factorial-base decomposition.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const path = process.argv.find(arg => arg.startsWith('--runtime='))?.slice(10)
    ?? 'packages/interpreter/out/index.js';
const { Interpreter } = await import(pathToFileURL(resolve(path)));
const source = readFileSync(new URL('../../demos/euler/254_digitfactorials.ra', import.meta.url), 'utf8')
    .replace('arg Top integer = 150', 'arg Top integer = 0');
const factorials = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];
for (const compilation of [true, false]) {
    const runtime = new Interpreter(() => {}, { compilation });
    try {
        runtime.execute(source);
        const table = runtime.variables.get('Length');
        assert.equal(table?.kind, 'array');
        assert.deepEqual(table.shape, [362880]);
        for (let r = 0; r < 362880; r++) {
            let rest = r, length = 0;
            for (let d = 8; d >= 1; d--) {
                length += Math.floor(rest / factorials[d]);
                rest %= factorials[d];
            }
            assert.equal(table.items[r], BigInt(length), `remainder ${r}`);
        }
    } finally { runtime.dispose(); }
}
console.log(JSON.stringify({ rows: 362880, engines: 2, passed: true }));
