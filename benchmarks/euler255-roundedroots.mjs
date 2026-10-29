// Fresh process timings exclude imports and include parsing/preparation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(
    option('runtime') ?? 'packages/interpreter/out/index.js')));
const main = fileURLToPath(new URL('../demos/euler/255_roundedroots.ra', import.meta.url));
const fixture = flag('fixture') || flag('default-fixture');
const file = flag('default-fixture') ? main.replace('.ra', '_default_test.ra')
    : fixture ? main.replace('.ra', '_test.ra') : main;
const n = option('Digits') ?? '14';
function load(id) {
    let source = readFileSync(id === main && option('source') ? option('source') : id, 'utf8');
    if (id !== main) return source;
    return source.replace('arg Digits integer = 14', `arg Digits integer = ${n}`);
}

const output = [], diagnostics = new RuntimeDiagnostics();
const runtime = new Interpreter(line => output.push(line), {
    compilation: !flag('reference'), testing: fixture, sourceId: file,
    loadModule(specifier, from) {
        const id = resolve(dirname(from ?? file), `${specifier}.ra`);
        return { id, source: load(id) };
    },
});
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(load(file)));
    const ms = performance.now() - start;
    const answer = fixture ? undefined : String(runtime.variables.get('Answer'));
    if (fixture) {
        assert.equal(runtime.testResults.length, 1);
        assert(runtime.testResults.every(test => test.passed));
    } else {
        let expected = option('expect');
        if (n === '14') expected ??= '4.447401118';
        if (expected !== undefined) assert.equal(answer, expected);
        assert.deepEqual(output, [answer]);
    }
    console.log(JSON.stringify({ args: process.argv.slice(2), ms, answer,
        total: String(runtime.variables.get('Total')), count: String(runtime.variables.get('Count')), rssMiB: process.resourceUsage().maxRSS / 1024, tests: runtime.testResults, diagnostics }));
} finally { runtime.dispose(); }
