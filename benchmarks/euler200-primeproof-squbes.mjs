// Run from the repository root; --runtime can point at an isolated experiment.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(option('runtime') ?? resolve('packages/interpreter/out/index.js')));
const fixture = process.argv.includes('--fixture'), reference = process.argv.includes('--reference');
const originalTests = process.argv.includes('--original-tests');
const file = fileURLToPath(new URL(`../demos/euler/200_primeproofsqube${fixture ? '_test' : ''}.ra`, import.meta.url));
const transform = text => originalTests ? text.replace('  Bound = 200\n', '').replace('  Bound = 2000000\n', '') : text;
const source = transform(readFileSync(file, 'utf8'));
const diagnostics = new RuntimeDiagnostics();
const runtime = new Interpreter(() => {}, { compilation: !reference, testing: fixture, sourceId: file,
    loadModule(specifier, from) { const id = resolve(dirname(from ?? file), `${specifier}.ra`); return { id, source: transform(readFileSync(id, 'utf8')) }; },
});
try {
    const start = performance.now();
    if (process.argv.includes('--diag')) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const ms = performance.now() - start, rssMiB = process.resourceUsage().maxRSS / 1024;
    const answer = fixture ? undefined : String(runtime.variables.get('Answer'));
    if (fixture) { assert.equal(runtime.testResults.length, 2); assert(runtime.testResults.every(t => t.passed)); }
    else assert.equal(answer, '229161792008');
    console.log(JSON.stringify({ fixture, reference, originalTests, ms, rssMiB, answer,
        sourceHash: createHash('sha256').update(source).digest('hex'), tests: runtime.testResults,
        ...(process.argv.includes('--diag') ? { diagnostics } : {}),
    }));
} finally { runtime.dispose(); }
