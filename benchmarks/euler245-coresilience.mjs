// Run in fresh processes. Import is excluded; parsing and preparation are included.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(
    option('runtime') ?? 'packages/interpreter/out/index.js')));
const main = fileURLToPath(new URL('../demos/euler/245_coresilience.ra', import.meta.url));
const file = flag('fixture') ? main.replace('.ra', '_test.ra') : main;
const expected = new Map([
    ['10', '0'], ['14', '0'], ['15', '15'], ['84', '15'], ['85', '100'],
    ['100', '100'], ['1000', '1594'], ['10000', '14438'], ['100000', '595394'],
    ['1000000', '11149065'], ['10000000', '275069018'],
    ['1000000000', '145645009845'], ['200000000000', '288084712410001'],
]);
function load(id) {
    let source = readFileSync(id, 'utf8');
    if (id !== main) return source;
    const variant = flag('original') ? 'original' : option('variant');
    if (variant) {
        const data = JSON.parse(readFileSync(new URL(
            './baselines/2026-10-28-euler245-investigation.json', import.meta.url), 'utf8'));
        assert(Object.hasOwn(data.sources, variant), `unknown variant ${variant}`);
        source = data.sources[variant];
    }
    if (option('Limit')) source = source.replace(/arg Limit integer = \d+/, `arg Limit integer = ${option('Limit')}`);
    return source;
}
const outputs = [], diagnostics = new RuntimeDiagnostics();
const runtime = new Interpreter(line => outputs.push(line), {
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
        assert.equal(runtime.testResults.length, 2);
        assert(runtime.testResults.every(test => test.passed));
    } else {
        const check = expected.get(option('Limit') ?? '200000000000');
        if (check) assert.equal(answer, check);
        assert.deepEqual(outputs, [answer]);
    }
    console.log(JSON.stringify({ args: process.argv.slice(2), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024, answer,
        tests: runtime.testResults, diagnostics }));
} finally { runtime.dispose(); }
