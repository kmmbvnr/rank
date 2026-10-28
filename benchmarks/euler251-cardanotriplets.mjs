// Fresh process timings exclude imports and include parsing/preparation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(
    option('runtime') ?? 'packages/interpreter/out/index.js')));
const main = fileURLToPath(new URL('../demos/euler/251_cardanotriplets.ra', import.meta.url));
const file = flag('fixture') ? main.replace('.ra', '_test.ra') : main;
const limit = option('Limit') ?? '110000000';
function load(id) {
    let source = readFileSync(id, 'utf8');
    if (id !== main) return source;
    if (option('variant')) {
        const data = JSON.parse(readFileSync(new URL('./baselines/2026-10-28-euler251.json', import.meta.url), 'utf8'));
        assert(Object.hasOwn(data.sources, option('variant')));
        source = data.sources[option('variant')];
    }
    return source.replace('arg Limit integer = 110000000', `arg Limit integer = ${limit}`);
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
    diagnostics.run(() => runtime.execute(load(file)));
    const ms = performance.now() - start;
    const answer = flag('fixture') ? undefined : String(runtime.variables.get('Answer'));
    if (flag('fixture')) {
        assert.equal(runtime.testResults.length, 3);
        assert(runtime.testResults.every(test => test.passed));
    } else {
        let expected = option('expect');
        if (limit === '110000000') expected ??= '18946051';
        if (expected !== undefined) assert.equal(answer, expected);
        assert.deepEqual(output, [answer]);
    }
    console.log(JSON.stringify({ args: process.argv.slice(2), ms, answer,
        rssMiB: process.resourceUsage().maxRSS / 1024, tests: runtime.testResults, diagnostics }));
} finally { runtime.dispose(); }
