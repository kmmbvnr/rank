import { readFileSync, appendFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(
    process.env.RUNTIME ?? process.cwd() + '/packages/interpreter/out/index.js'));
// node benchmarks/euler264-investigation.mjs [compiled|reference] [limit=100000] [variant=original]
const [mode = 'compiled', limit = '100000', variant = 'original'] = process.argv.slice(2);
assert(['compiled', 'reference'].includes(mode));
assert(['original', 'gcd', 'gcd-circle', 'gcd-positive', 'positive', 'gcd-circle-positive', 'shipping'].includes(variant));
assert(/^\d+$/.test(limit));
const file = new URL(variant === 'shipping'
    ? '../demos/euler/264_trianglecentres.ra' : './experiments/euler264-original.ra', import.meta.url);
let source = readFileSync(file, 'utf8');
if (variant.includes('gcd')) source = source.replace(
    /    G1 = X abs[\s\S]*?    if G1 not equal 1/,
    '    G1 = X gcd Y\n    if G1 not equal 1');
if (variant.includes('circle')) source = source.replace(
    '  for Y in (0 - Lm) to Lm',
    '  Ym = (Qm - X * X) max 0\n  Ym = Ym isqrt\n  for Y in (0 - Ym) to Ym');
if (variant.includes('positive')) source = source.replace('for X in (0 - Lm) to Lm', 'for X in 1 to Lm');
source = source.replace('arg Limit integer = 100000', `arg Limit integer = ${limit}`);
const diagnostics = new RuntimeDiagnostics();
const runtime = new Interpreter(() => {}, {
    compilation: mode === 'compiled',
    onIntegerLoopCompiled: process.env.DUMP ? code => appendFileSync(process.env.DUMP, code + '\n// NEXT\n') : undefined,
});
const started = performance.now();
try {
    diagnostics.run(() => runtime.execute(source));
    const answer = String(runtime.variables.get('Answer'));
    if (limit === '100000') assert.equal(answer, '2816417.1055');
    console.log(JSON.stringify({ mode, limit, variant, ms: performance.now() - started, answer,
        nc: String(runtime.variables.get('Nc')), lm: String(runtime.variables.get('Lm')),
        rss: process.resourceUsage().maxRSS / 1024, diagnostics }));
} finally { runtime.dispose(); }
