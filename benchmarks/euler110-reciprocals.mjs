// Build: npx tsc -b tsconfig.build.json
// Run: node benchmarks/euler110-reciprocals.mjs 4000000
// --source=PATH selects an archived demo; --trim/--lazy reproduce research variants.
// --reference disables compilation. Keep --diag/--trace separate from timings.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const demo = option('demo') ?? '110_reciprocals2';
const target = process.argv[2] ?? '4000000';
const diagnostic = process.argv.includes('--diag');
const original = readFileSync(option('source') ?? new URL(`../demos/euler/${demo}.ra`, import.meta.url), 'utf8');
let source = original.replace(/Target integer = \d+/, `Target integer = ${target}`);
if (process.argv.includes('--trim') && !source.includes('Top max')) {
    source = source.replace('Cols = Exp reshape 1 60\n', '').replace('  Rows = N len',
        '  if N len equal 0\n    break\n  end\n  Exp = 1 to (Top max) array\n'
        + '  Cols = Exp reshape 1 (Exp len)\n  Rows = N len');
}
if (process.argv.includes('--lazy')) {
    source = source.replace('  Big =', "  Big' =").replace('  Next =', "  Next' =");
}
if (process.argv.includes('--trace')) {
    source = source.replace('  Rows = N len', '  P print\n  Rows = N len\n  Rows print')
        .replace('  Cnt = Next filter Keep array', '  Cnt = Next filter Keep array\n  Best print');
}
const diagnostics = new RuntimeDiagnostics();
const start = performance.now();
const runtime = new Interpreter(line => {
    process.stderr.write(JSON.stringify({ ms: performance.now() - start, out: line }) + '\n');
}, { compilation: !process.argv.includes('--reference') });
try {
    if (diagnostic) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const ms = performance.now() - start;
    const rss = process.resourceUsage().maxRSS / 1024;
    const answer = String(runtime.variables.get('Answer'));
    const golden = { 4000000: '9350130049860600', 1000: '180180', 3: '6' }[target];
    if (golden) assert.equal(answer, golden);
    console.log(JSON.stringify({ demo, target, ms, rss, answer,
        sourceHash: createHash('sha256').update(source).digest('hex'),
        ...(diagnostic ? { diagnostics } : {}) }));
} finally { runtime.dispose(); }
