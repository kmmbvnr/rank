// Fresh-process samples; import is excluded, parsing/preparation are included.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(
    option('runtime') ?? 'packages/interpreter/out/index.js')));
const main = fileURLToPath(new URL('../demos/euler/238_infinitestring.ra', import.meta.url));
const file = flag('fixture') ? main.replace('.ra', '_test.ra') : main;
const variant = flag('original') ? 'original' : option('variant');
const expected = new Map([
    ['1', '1'], ['2', '4'], ['10', '60'], ['100', '581'], ['1000', '4742'],
    ['2000000000000000', '9922545104535661'],
]);
function load(id) {
    let source = readFileSync(id, 'utf8');
    if (id !== main) return source;
    if (variant) {
        const baseline = JSON.parse(readFileSync(new URL(
            './baselines/2026-10-28-euler238-investigation.json', import.meta.url), 'utf8'));
        assert(variant in baseline.sources, `unknown variant ${variant}`);
        source = baseline.sources[variant];
    }
    if (option('Top')) source = source.replace(/arg Top integer = \d+/, `arg Top integer = ${option('Top')}`);
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
        assert.equal(runtime.testResults.length, 1);
        assert(runtime.testResults.every(test => test.passed));
    } else {
        const check = expected.get(option('Top') ?? '2000000000000000');
        if (check) assert.equal(answer, check);
        assert.deepEqual(outputs, [answer]);
    }
    console.log(JSON.stringify({ args: process.argv.slice(2), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024, answer, outputs,
        tests: runtime.testResults, diagnostics }));
} finally { runtime.dispose(); }
