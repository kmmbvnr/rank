// Fresh-process harness; --runtime can point at an isolated baseline build.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(option('runtime') ?? resolve('packages/interpreter/out/index.js')));
const file = fileURLToPath(new URL(`../demos/euler/210_obtuse${flag('fixture') ? '_test' : ''}.ra`, import.meta.url));
function transform(source) {
    if (flag('original')) source = source
        .replace('arg Chunk integer = 250000', 'arg Chunk integer = 5000000')
        .replace("  Part' = (Q - Xs * Xs) isqrt sum\n  Gen += Part", '  Gen += (Q - Xs * Xs) isqrt sum');
    if (option('R')) source = source.replace('arg R integer = 1000000000', `arg R integer = ${option('R')}`);
    if (option('Chunk')) source = source.replace(/arg Chunk integer = \d+/, `arg Chunk integer = ${option('Chunk')}`);
    if (flag('scalar')) source = source.replace(/for L in A0 \+ 1 to A by Chunk[\s\S]*?\nend/,
        'for X in A0 + 1 to A\n  Gen += (Q - X * X) isqrt\nend');
    if (flag('plan')) source = source.replace('  Gen += (Q - Xs * Xs) isqrt sum',
        "  Part' = (Q - Xs * Xs) isqrt sum\n  Gen += Part");
    if (flag('deferred')) source = source.replace('  Xs =', "  Xs' =");
    if (flag('sequence')) source = source.replace('L + Chunk - 1 min A) array', 'L + Chunk - 1 min A)');
    return source;
}
const source = transform(readFileSync(file, 'utf8'));
const runtime = new Interpreter(() => {}, { compilation: !flag('reference'), testing: flag('fixture'), sourceId: file,
    loadModule(specifier, from) {
        const id = resolve(dirname(from ?? file), `${specifier}.ra`);
        return { id, source: transform(readFileSync(id, 'utf8')) };
    },
});
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    if (flag('diag')) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const ms = performance.now() - start, rssMiB = process.resourceUsage().maxRSS / 1024;
    const answer = flag('fixture') ? undefined : String(runtime.variables.get('Answer'));
    if (flag('fixture')) { assert.equal(runtime.testResults.length, 1); assert(runtime.testResults.every(t => t.passed)); }
    else if (!option('R') || option('R') === '1000000000') assert.equal(answer, '1598174770174689458');
    console.log(JSON.stringify({ args: process.argv.slice(2), ms, rssMiB, answer,
        sourceHash: createHash('sha256').update(source).digest('hex'), tests: runtime.testResults,
        ...(flag('diag') ? { diagnostics } : {}),
    }));
} finally { runtime.dispose(); }
