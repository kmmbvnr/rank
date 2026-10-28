// Fresh-process Euler 214 harness; original source is retained in the baseline.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(
    option('runtime') ?? 'packages/interpreter/out/index.js')));
const variant = option('variant') ?? 'shipping';
assert(['shipping', 'original', 'inplace', 'separate', 'helper'].includes(variant));
const fixture = flag('fixture');
const main = fileURLToPath(new URL('../demos/euler/214_totientchains.ra', import.meta.url));
const file = fixture ? main.replace('.ra', '_test.ra') : main;
const captured = variant === 'original' ? JSON.parse(readFileSync(new URL(
    './baselines/2026-10-27-euler214-investigation.json', import.meta.url), 'utf8')) : undefined;
function load(id) {
    let source = captured ? (id === main ? captured.originalSource : captured.originalFixture)
        : readFileSync(id !== main || variant === 'shipping' ? id
            : new URL(`./experiments/euler214-${variant}.ra`, import.meta.url), 'utf8');
    for (const name of ['Limit', 'Len', 'Block']) {
        if (option(name)) source = source.replace(new RegExp(`option ${name} integer = \\d+`),
            `option ${name} integer = ${option(name)}`);
    }
    return source;
}
const runtime = new Interpreter(() => {}, {
    compilation: !flag('reference'), testing: fixture, sourceId: file,
    loadModule(specifier, from) {
        const id = resolve(dirname(from ?? file), `${specifier}.ra`);
        return { id, source: load(id) };
    },
});
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(load(file)));
    const ms = performance.now() - start;
    const answer = fixture ? undefined : String(runtime.variables.get('Answer'));
    if (fixture) {
        assert.equal(runtime.testResults.length, variant === 'original' ? 1 : 2);
        assert(runtime.testResults.every(test => test.passed));
    } else if ((!option('Limit') || option('Limit') === '40000000') && (!option('Len') || option('Len') === '25')) {
        assert.equal(answer, '1677366278943');
    }
    console.log(JSON.stringify({ args: process.argv.slice(2), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024, answer, tests: runtime.testResults, diagnostics }));
} finally { runtime.dispose(); }
