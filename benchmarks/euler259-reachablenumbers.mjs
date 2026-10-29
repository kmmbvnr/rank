// Fresh process timings exclude imports and include parsing/preparation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
const { Interpreter, RuntimeDiagnostics, withInterrupt } = await import(pathToFileURL(resolve(
    option('runtime') ?? 'packages/interpreter/out/index.js')));
const main = fileURLToPath(new URL('../demos/euler/259_reachablenumbers.ra', import.meta.url));
const file = flag('fixture') ? main.replace('.ra', '_test.ra') : main;
const n = option('Top') ?? '9';
const filter = '        rem No later interval needs the final fractions.\n'
    + '        if L equal Top\n          More = More filter (Rd equal 1) array\n        end\n';
assert(['shipping', 'original'].includes(option('variant') ?? 'shipping'));
function load(id) {
    let source = readFileSync(id === main && option('source') ? option('source') : id, 'utf8');
    if (id !== main) return source;
    if (option('variant') === 'original') {
        assert(source.includes(filter));
        source = source.replace(filter, '');
    }
    return source.replace('arg Top integer = 9', `arg Top integer = ${n}`);
}

// Enumerate every expression tree without deduplicating interval states or
// packing fractions. Unreduced BigInt pairs keep this oracle independent of
// the demo's gcd normalization and key encoding.
function enumerate(first, last) {
    const results = [[BigInt(Array.from({ length: last - first + 1 }, (_, i) => first + i).join('')), 1n]];
    for (let split = first; split < last; split++) {
        for (const [a, b] of enumerate(first, split)) for (const [c, d] of enumerate(split + 1, last)) {
            results.push([a * d + c * b, b * d], [a * d - c * b, b * d], [a * c, b * d]);
            if (c !== 0n) results.push([a * d, b * c]);
        }
    }
    return results;
}

if (flag('verify')) {
    let checks = 0;
    for (let top = 1; top <= 6; top++) {
        const integers = new Set(enumerate(1, top).filter(([a, b]) => a % b === 0n && a / b > 0n).map(([a, b]) => a / b));
        const expected = String([...integers].reduce((sum, value) => sum + value, 0n));
        for (const reference of [false, true]) {
            const args = [fileURLToPath(import.meta.url), `--Top=${top}`, `--expect=${expected}`];
            if (option('runtime')) args.push(`--runtime=${option('runtime')}`);
            if (reference) args.push('--reference');
            const child = spawnSync(process.execPath, args, { encoding: 'utf8' });
            assert.equal(child.status, 0, child.stderr);
            assert.equal(JSON.parse(child.stdout).answer, expected);
            checks++;
        }
    }
    console.log(JSON.stringify({ checks }));
    process.exit(0);
}

const output = [], diagnostics = new RuntimeDiagnostics();
const runtime = new Interpreter(line => output.push(line), {
    compilation: !flag('reference'), testing: flag('fixture'), sourceId: file,
    loadModule(specifier, from) {
        const id = resolve(dirname(from ?? file), `${specifier}.ra`);
        return { id, source: load(id) };
    },
});
try {
    const start = performance.now();
    const run = () => diagnostics.run(() => runtime.execute(load(file)));
    if (flag('interrupt')) withInterrupt(new Int32Array(new SharedArrayBuffer(12)), run);
    else run();
    const ms = performance.now() - start;
    const answer = flag('fixture') ? undefined : String(runtime.variables.get('Answer'));
    if (flag('fixture')) {
        assert.equal(runtime.testResults.length, 2);
        assert(runtime.testResults.every(test => test.passed));
    } else {
        let expected = option('expect');
        expected ??= ({ 1: '1', 2: '17', 3: '255', 4: '4179', 5: '74689', 6: '1486823', 9: '20101196798' })[n];
        if (expected !== undefined) assert.equal(answer, expected);
        assert.deepEqual(output, [answer]);
    }
    console.log(JSON.stringify({ args: process.argv.slice(2), ms, answer,
        sourceHash: createHash('sha256').update(load(main)).digest('hex'),
        rssMiB: process.resourceUsage().maxRSS / 1024, tests: runtime.testResults, diagnostics }));
} finally { runtime.dispose(); }
