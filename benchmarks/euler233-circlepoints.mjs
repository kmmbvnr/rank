// Run each sample in a fresh process. Runtime import is outside the timer.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(
    option('runtime') ?? 'packages/interpreter/out/index.js')));
const main = fileURLToPath(new URL('../demos/euler/233_circlepoints.ra', import.meta.url));
const fixture = flag('fixture');
const file = fixture ? main.replace('.ra', '_test.ra') : main;
function load(id) {
    let source = readFileSync(id, 'utf8');
    if (id !== main) return source;
    if (flag('original')) source = JSON.parse(readFileSync(new URL(
        './baselines/2026-10-28-euler233-investigation.json', import.meta.url), 'utf8')).sources.original.source;
    if (option('Limit')) source = source.replace(/option Limit integer = \d+/,
        `option Limit integer = ${option('Limit')}`);
    if (flag('phases')) for (const [at, name] of [
        ['Top =', 'start'], ['Cum =', 'sieve'], ['Cap =', 'cum'],
        ['Total =', 'arrays'], ['Ea =', 'triples'], ['Answer =', 'pairs'],
    ]) source = source.replace(at, `"phase:${name}" print\n${at}`);
    return source;
}
const diagnostics = new RuntimeDiagnostics();
const phases = [];
let start;
const runtime = new Interpreter(line => {
    if (line.startsWith('phase:')) phases.push({ name: line, ms: performance.now() - start });
}, {
    compilation: !flag('reference'), testing: fixture, sourceId: file,
    loadModule(specifier, from) {
        const id = resolve(dirname(from ?? file), `${specifier}.ra`);
        return { id, source: load(id) };
    },
});
try {
    start = performance.now();
    diagnostics.run(() => runtime.execute(load(file)));
    const ms = performance.now() - start;
    const answer = fixture ? undefined : String(runtime.variables.get('Answer'));
    if (fixture) {
        assert.equal(runtime.testResults.length, 2);
        assert(runtime.testResults.every(test => test.passed));
    } else {
        const expected = { '10000000': '1722531830', '20000000': '7843770952',
            '100000000000': '271204031455541309' }[option('Limit') ?? '100000000000'];
        if (expected) assert.equal(answer, expected);
    }
    console.log(JSON.stringify({ args: process.argv.slice(2), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024, answer,
        tests: runtime.testResults, phases, diagnostics }));
} finally { runtime.dispose(); }
