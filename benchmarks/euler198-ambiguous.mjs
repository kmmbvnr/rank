// Fresh-process Euler 198 investigation; runtime can point at an isolated build.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(option('runtime') ?? resolve('packages/interpreter/out/index.js')));
const limit = Number(option('limit') ?? 100000000);
const fixture = process.argv.includes('--fixture'), reference = process.argv.includes('--reference');
const file = fileURLToPath(new URL(`../demos/euler/198_ambiguous${fixture ? '_test' : ''}.ra`, import.meta.url));
// Experimental source variant only; the demo file is not rewritten.
const variant = option('variant') ?? 'base';
assert(['base', 'original', 'tail', 'stack'].includes(variant));
const transform = text => {
    text = text.replace('Limit integer = 100000000', `Limit integer = ${limit}`);
    if (variant === 'original' || variant === 'tail') {
        text = text.replace('use numbers\n', '').replace(/rem Pending right children[\s\S]*?Sa = array shape StackSize/, 'Sa = array shape 100000')
            .replaceAll('array shape StackSize', 'array shape 100000');
    }
    if (variant === 'original' || variant === 'stack') text = text.replace(/    rem No more right children:[\s\S]*?    Mid =/, '    Mid =');
    return text;
};
const source = transform(readFileSync(file, 'utf8'));
const diagnostics = new RuntimeDiagnostics();
const generated = [];
const runtime = new Interpreter(() => {}, { compilation: !reference, testing: fixture, sourceId: file,
    loadModule(specifier, from) { const id = resolve(dirname(from ?? file), `${specifier}.ra`); return { id, source: transform(readFileSync(id, 'utf8')) }; },
    ...(process.argv.includes('--generated') ? { onIntegerLoopCompiled: source => generated.push(source) } : {}),
});
try {
    const start = performance.now();
    if (process.argv.includes('--diag')) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const ms = performance.now() - start, rssMiB = process.resourceUsage().maxRSS / 1024;
    const answer = fixture ? undefined : String(runtime.variables.get('Answer'));
    if (fixture) { assert.equal(runtime.testResults.length, 3); assert(runtime.testResults.every(t => t.passed)); }
    else {
        const golden = { 120: '10', 200000: '100967', 1000000: '509763', 100000000: '52374425' }[limit];
        if (golden) assert.equal(answer, golden);
        if (process.argv.includes('--oracle')) assert.equal(answer, String(oracle(limit)));
    }
    console.log(JSON.stringify({ limit, variant, fixture, reference, ms, rssMiB, answer,
        sourceHash: createHash('sha256').update(source).digest('hex'),
        ...(process.argv.includes('--diag') ? { diagnostics } : {}), ...(generated.length ? { generated } : {}) }));
} finally { runtime.dispose(); }

// Enumerate coprime denominator pairs directly, rather than traverse the tree.
function oracle(limit) {
    assert(limit >= 0 && limit <= 10000);
    let count = 0;
    const half = Math.floor(limit / 2);
    for (let b = 1; b <= half; b++) for (let d = 1; b * d <= half; d++) {
        let x = b, y = d;
        while (y) [x, y] = [y, x % y];
        if (x !== 1) continue;
        let a = 0;
        while ((a * d + 1) % b !== 0) a++;
        const c = (a * d + 1) / b;
        if (c <= d && 100 * (a * d + b * c) < 2 * b * d) count++;
    }
    return count;
}
