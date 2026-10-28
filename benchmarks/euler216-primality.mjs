// Run each sample in a fresh process; impose deadlines externally.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(
    option('runtime') ?? 'packages/interpreter/out/index.js')));
const variant = option('variant') ?? 'shipping';
assert(['shipping', 'original', 'residual', 'segmented', 'bulk', 'guarded', 'split'].includes(variant));
const main = fileURLToPath(new URL('../demos/euler/216_primality.ra', import.meta.url));
const fixture = flag('fixture');
const file = fixture ? main.replace('.ra', '_test.ra') : main;
const captured = JSON.parse(readFileSync(new URL(
    './baselines/2026-10-27-euler216-investigation.json', import.meta.url), 'utf8'));
function load(id) {
    let source = id === main && variant === 'original' ? captured.originalSource
        : readFileSync(id === main && !['original', 'shipping'].includes(variant)
            ? new URL(`./experiments/euler216-${variant}.ra`, import.meta.url) : id, 'utf8');
    if (option('Limit')) source = source.replace(/arg Limit integer = \d+/,
        `arg Limit integer = ${option('Limit')}`);
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
        assert.equal(runtime.testResults.length, 2);
        assert(runtime.testResults.every(test => test.passed));
    } else {
        const expected = new Map([['100', '45'], ['10000', '2202'], ['100000', '17185'],
            ['1000000', '141444'], ['50000000', '5437849']]);
        const golden = expected.get(option('Limit') ?? '50000000');
        if (golden) assert.equal(answer, golden);
    }
    console.log(JSON.stringify({ args: process.argv.slice(2), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024, answer, tests: runtime.testResults, diagnostics }));
} finally { runtime.dispose(); }
