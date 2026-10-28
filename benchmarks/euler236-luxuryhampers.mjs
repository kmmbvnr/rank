// Run samples in fresh processes. Import time is excluded; parse and preparation are included.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(
    option('runtime') ?? 'packages/interpreter/out/index.js')));
const main = fileURLToPath(new URL('../demos/euler/236_luxuryhampers.ra', import.meta.url));
const fixture = flag('fixture');
const file = fixture ? main.replace('.ra', '_test.ra') : main;
function load(id) {
    let source = readFileSync(id, 'utf8');
    if (id !== main) return source;
    if (flag('original')) source = JSON.parse(readFileSync(new URL(
        './baselines/2026-10-28-euler236-investigation.json', import.meta.url), 'utf8')).sources.original;
    if (option('Top')) source = source.replace(/arg Top integer = \d+/, `arg Top integer = ${option('Top')}`);
    if (flag('solutions')) source = source.replace('      Cnt += 1', '      U print\n      V print\n      Cnt += 1');
    return source;
}
const outputs = [], diagnostics = new RuntimeDiagnostics();
const runtime = new Interpreter(line => outputs.push(line), {
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
    const count = fixture ? undefined : Number(runtime.variables.get('Cnt'));
    if (fixture) {
        assert.equal(runtime.testResults.length, 2);
        assert(runtime.testResults.every(test => test.passed));
    } else if (!option('Top') || option('Top') === '5248' || option('Top') === '300') {
        assert.equal(answer, '123/59');
        assert.equal(count, option('Top') === '300' ? 21 : 35);
    }
    const solutions = flag('solutions') ? outputs.slice(0, -1).reduce((pairs, value, index, values) => {
        if (index % 2 === 0) pairs.push([Number(value), Number(values[index + 1])]);
        return pairs;
    }, []) : undefined;
    console.log(JSON.stringify({ args: process.argv.slice(2), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024, answer, count, solutions,
        tests: runtime.testResults, diagnostics }));
} finally { runtime.dispose(); }
