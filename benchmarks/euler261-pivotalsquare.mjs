// RUNTIME=/path/to/out/index.js node benchmarks/euler261-pivotalsquare.mjs 10000000000 compiled table
import { readFileSync, appendFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(
    process.env.RUNTIME ?? 'packages/interpreter/out/index.js')).href);
const [limit = '3000000', mode = 'compiled', variant = 'table'] = process.argv.slice(2);
assert(/^\d+$/.test(limit));
assert(['compiled', 'reference'].includes(mode));
assert(['original', 'table'].includes(variant));
const source = readFileSync(new URL(variant === 'original'
    ? './experiments/euler261-original.ra' : '../demos/euler/261_pivotalsquare.ra', import.meta.url), 'utf8')
    .replace('arg Limit integer = 10000000000', `arg Limit integer = ${limit}`);
const diagnostics = new RuntimeDiagnostics();
const output = [];
const runtime = new Interpreter(line => output.push(line), {
    compilation: mode !== 'reference',
    onIntegerLoopCompiled: process.env.DUMP
        ? code => appendFileSync(process.env.DUMP, `${code}\n// NEXT\n`) : undefined,
});
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start;
    const answer = String(runtime.variables.get('Answer'));
    const expected = { 0: 0, 3: 0, 4: 4, 110: 355, 1000: 9167,
        200000: 23434786, 3000000: 1305678503, 10000000000: 238890850232021 }[limit];
    if (expected !== undefined) assert.equal(answer, String(expected));
    assert.deepEqual(output, [answer]);
    console.log(JSON.stringify({ limit, mode, variant, ms, answer,
        rssMiB: process.resourceUsage().maxRSS / 1024, diagnostics }));
} finally {
    runtime.dispose();
}
