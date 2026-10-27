// Fresh-process Euler 212 harness; --baseline uses the captured original source.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
const {Interpreter, RuntimeDiagnostics} = await import(pathToFileURL(resolve(option('runtime') ?? 'packages/interpreter/out/index.js')));
const fixture = flag('fixture');
const file = fileURLToPath(new URL(`../demos/euler/212_combinedvolume${fixture ? '_test' : ''}.ra`, import.meta.url));
const main = resolve(dirname(file), '212_combinedvolume.ra');
const baseline = flag('baseline') ? JSON.parse(readFileSync(new URL('./baselines/2026-10-27-euler212-investigation.json', import.meta.url), 'utf8')).originalSource : undefined;
function load(id) {
    return (id === main && baseline !== undefined ? baseline : readFileSync(id, 'utf8'))
        .replace('integer = 50000', `integer = ${option('N') ?? '50000'}`);
}
const source = load(file);
const runtime = new Interpreter(() => {}, {
    compilation: !flag('reference'), sourceId: file, testing: fixture,
    loadModule(specifier, from) {
        const id = resolve(dirname(from ?? file), `${specifier}.ra`);
        return {id, source: load(id)};
    },
});
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start;
    const answer = fixture ? undefined : String(runtime.variables.get('Answer'));
    if (fixture) {
        assert.equal(runtime.testResults.length, 1);
        assert(runtime.testResults.every(test => test.passed));
    } else if (!option('N') || option('N') === '50000') assert.equal(answer, '328968937309');
    console.log(JSON.stringify({args: process.argv.slice(2), ms, rssMiB: process.resourceUsage().maxRSS / 1024,
        answer, sourceHash: createHash('sha256').update(source).digest('hex'), tests: runtime.testResults, diagnostics}));
} finally { runtime.dispose(); }
