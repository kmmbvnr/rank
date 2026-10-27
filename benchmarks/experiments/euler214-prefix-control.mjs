// Existing Euler 311 helper, with the independently tested reduced input.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(
    process.argv[2] ?? 'packages/interpreter/out/index.js')));
const file = fileURLToPath(new URL('../../demos/euler/311_biclinic.ra', import.meta.url));
const program = readFileSync(file, 'utf8');
const source = 'use numbers\n' + program.slice(program.indexOf('fun Low biclinic_block High'))
    + '\nAnswer = 1 biclinic_block 250000';
// Exercise function-body execution, as in dense-sum-squares.test.ts, rather
// than the separate scalar-entry compiler used by the whole Euler 311 main.
const runtime = new Interpreter(() => {}, { sourceId: file, scalarEntryCompilation: false });
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start;
    assert.equal(runtime.variables.get('Answer'), 38239n);
    console.log(JSON.stringify({ ms, rssMiB: process.resourceUsage().maxRSS / 1024,
        answer: String(runtime.variables.get('Answer')), diagnostics }));
} finally { runtime.dispose(); }
