// Fresh process timings exclude imports and include parsing/preparation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
const { Interpreter, RuntimeDiagnostics, withInterrupt } = await import(pathToFileURL(resolve(
    option('runtime') ?? 'packages/interpreter/out/index.js')));
const main = fileURLToPath(new URL('../demos/euler/257_angularbisectors.ra', import.meta.url));
const fixture = flag('fixture');
const file = fixture ? main.replace('.ra', '_test.ra') : main;
const n = option('Limit') ?? '100000000';
function load(id) {
    let source = readFileSync(id === main && option('source') ? option('source') : id, 'utf8');
    if (id !== main) return source;
    return source.replace('arg Limit integer = 100000000', `arg Limit integer = ${n}`);
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
    const execute = () => diagnostics.run(() => runtime.execute(load(file)));
    if (flag('interrupt')) withInterrupt(new Int32Array(new SharedArrayBuffer(12)), execute);
    else execute();
    const ms = performance.now() - start;
    const answer = fixture ? undefined : String(runtime.variables.get('Answer'));
    if (fixture) {
        assert.equal(runtime.testResults.length, 2);
        assert(runtime.testResults.every(test => test.passed));
    } else {
        let expected = option('expect');
        if (n === '100000000') expected ??= '139012411';
        if (expected !== undefined) assert.equal(answer, expected);
        assert.deepEqual(output, [answer]);
    }
    console.log(JSON.stringify({ args: process.argv.slice(2), ms, answer,
        total: String(runtime.variables.get('Total')), rssMiB: process.resourceUsage().maxRSS / 1024, tests: runtime.testResults, diagnostics }));
} finally { runtime.dispose(); }
