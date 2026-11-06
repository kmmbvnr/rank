import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '../..'));
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const { typedArray } = await import(pathToFileURL(`${root}/packages/interpreter/out/array-storage.js`));
const count = 1048576, values = BigInt64Array.from({ length: 128 }, (_, i) => 3000000000n + BigInt(i));
let expected = 0n;
for (let i = 0; i < values.length; i++) expected += values[i] / BigInt(i + 1);
expected *= BigInt(count / values.length);
const diagnostics = process.env.DIAGNOSTICS ? new RuntimeDiagnostics() : undefined;
const runtime = new Interpreter(() => {});
try {
    runtime.variables.set('Input', typedArray(values));
    const source = `use sequences\nuse numbers
Keys = (0 till ${count}) mod 128
Divisors = Keys + 1
Values' = Input Keys
Quotients' = Values // Divisors
Answer = Quotients sum`;
    const start = performance.now();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    const answer = runtime.variables.get('Answer');
    assert.equal(answer, expected);
    console.log(JSON.stringify({ count, answer: String(answer), ms: performance.now() - start,
        maxRssMiB: process.resourceUsage().maxRSS / 1024, ...(diagnostics && { diagnostics }) }));
} finally { runtime.dispose(); }
