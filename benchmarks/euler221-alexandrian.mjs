// Run each sample in a fresh process; impose deadlines externally.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(
    option('runtime') ?? 'packages/interpreter/out/index.js')));
const main = fileURLToPath(new URL('../demos/euler/221_alexandrian.ra', import.meta.url));
const fixture = flag('fixture');
const file = fixture ? main.replace('.ra', '_test.ra') : main;
function load(id) {
    let source = id === main && flag('original') ? JSON.parse(readFileSync(new URL(
        './baselines/2026-10-28-euler221-investigation.json', import.meta.url), 'utf8')).originalSource
        : readFileSync(id === main && option('source') ? resolve(option('source')) : id, 'utf8');
    for (const name of ['Limit', 'N']) if (option(name)) source = source.replace(
        new RegExp(`option ${name} integer = \\d+`), `option ${name} integer = ${option(name)}`);
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
        if (!option('Limit') && !option('N')) assert.equal(answer, '1884161251122450');
    }
    console.log(JSON.stringify({ args: process.argv.slice(2), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024, answer, tests: runtime.testResults, diagnostics }));
} finally { runtime.dispose(); }
