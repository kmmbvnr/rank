// Run each sample in a fresh process; impose deadlines externally.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(
    option('runtime') ?? 'packages/interpreter/out/index.js')));
const main = fileURLToPath(new URL('../demos/euler/229_foursquares.ra', import.meta.url));
const fixture = flag('fixture');
const file = fixture ? main.replace('.ra', '_test.ra') : main;
const variant = option('variant');
const sources = variant ? JSON.parse(readFileSync(new URL(
    './baselines/2026-10-28-euler229-investigation.json', import.meta.url), 'utf8')).sources : undefined;
if (variant && !sources[variant]) throw new Error(`Unknown variant: ${variant}`);
function load(id) {
    if (id !== main) return readFileSync(id, 'utf8');
    let source = variant ? sources[variant] : readFileSync(option('source') ?? id, 'utf8');
    if (option('Limit')) source = source.replace(/option Limit integer = \d+/,
        `option Limit integer = ${option('Limit')}`);
    if (flag('phases')) for (const [at, name] of [
        ['Rt = Limit isqrt', 'start'], ['Gp = Gp filter', 'sieve'],
        ['Total = 0', 'queries'], ['Sp = array', 'search'], ['Answer = Total + Sq', 'squares'],
    ]) source = source.replace(at, `"phase:${name}" print\n${at}`);
    return source;
}
const diagnostics = new RuntimeDiagnostics();
const phases = [];
let start;
const runtime = new Interpreter(line => {
    if (line.startsWith('phase:')) phases.push({ phase: line,
        ms: performance.now() - start, diagnostics: JSON.parse(JSON.stringify(diagnostics)) });
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
        const expected = { '1000000': '8637', '10000000': '75373',
            '2000000000': '11325263' }[option('Limit') ?? '2000000000'];
        if (expected) assert.equal(answer, expected);
    }
    console.log(JSON.stringify({ args: process.argv.slice(2), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024, answer,
        Sq: String(runtime.variables.get('Sq')), Total: String(runtime.variables.get('Total')),
        tests: runtime.testResults, phases, diagnostics }));
} finally { runtime.dispose(); }
