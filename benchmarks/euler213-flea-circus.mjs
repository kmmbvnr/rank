// Compare shipping Euler 213 with captured pre-change source and diagnostic variants.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
const variant = option('variant') ?? 'shipping';
assert(['shipping', 'original', 'gcopy', 'shift', 'shiftcached', 'cached'].includes(variant));
const {Interpreter, RuntimeDiagnostics} = await import(pathToFileURL(resolve(option('runtime') ?? 'packages/interpreter/out/index.js')));
const fixture = flag('fixture');
const main = fileURLToPath(new URL('../demos/euler/213_fleacircus.ra', import.meta.url));
const file = fixture ? main.replace('.ra', '_test.ra') : main;
function load(id) {
    const baseline = variant !== 'shipping' ? JSON.parse(readFileSync(new URL('./baselines/2026-10-27-euler213-investigation.json', import.meta.url), 'utf8')) : undefined;
    let source = baseline && id === main ? baseline.originalSource : baseline && id !== main ? baseline.originalFixture : readFileSync(id, 'utf8');
    if (id !== main) return source;
    if (option('N')) source = source.replace('integer = 30', `integer = ${option('N')}`);
    if (option('Rings')) source = source.replace('integer = 50', `integer = ${option('Rings')}`);
    if (variant === 'gcopy') source = source.replace('reshape 4 (Z * Fn)', 'reshape 4 (Z * Fn) copy');
    if (variant.startsWith('shift')) source = source.replace(/for R in 1 to Rings[\s\S]*?end/, `for R in 1 to Rings
  Q = (D * Wt) reshape N N Fn
  Uq' = Q shift 1 with 0.0 axis 0
  Dq' = Q shift -1 with 0.0 axis 0
  Lq' = Q shift 1 with 0.0 axis 1
  Rq' = Q shift -1 with 0.0 axis 1
  D = ((Uq + Dq) + Lq + Rq) reshape (Z * Fn) copy
end`);
    if (variant.endsWith('cached')) source = source.replace("Deg' =", 'Deg =').replace("Inv' =", 'Inv =');
    return source;
}
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
    diagnostics.run(() => runtime.execute(load(file)));
    const ms = performance.now() - start;
    const answer = fixture ? undefined : String(runtime.variables.get('Answer'));
    if (fixture) {
        assert.equal(runtime.testResults.length, variant === 'shipping' ? 2 : 1);
        assert(runtime.testResults.every(test => test.passed));
    } else if ((!option('N') || option('N') === '30') && (!option('Rings') || option('Rings') === '50')) {
        assert.equal(answer, '330.721154');
    }
    console.log(JSON.stringify({variant, reference: flag('reference'), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024, answer, tests: runtime.testResults, diagnostics}));
} finally { runtime.dispose(); }
