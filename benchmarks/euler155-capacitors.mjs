// Build: npx tsc -b tsconfig.build.json
// Run one fresh process per sample; keep --diag/--trace separate from timings.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const { Interpreter, RuntimeDiagnostics } = await import(option('runtime')
    ? pathToFileURL(option('runtime')).href : '../packages/interpreter/out/index.js');
const count = Number(option('count') ?? 18);
const variant = option('variant') ?? 'base';
assert(['base', 'rec', 'lev', 'eager', 'sort', 'recsort'].includes(variant));
let source = readFileSync(option('source') ?? new URL('../demos/euler/155_capacitors.ra', import.meta.url), 'utf8')
    .replace('Count integer = 18', `Count integer = ${count}`);
if (['rec', 'eager', 'recsort'].includes(variant)) source = source.replace("  Rec' =", '  Rec =');
if (['lev', 'eager'].includes(variant)) source = source.replace("  Lev' =", '  Lev =');
if (['sort', 'recsort'].includes(variant)) source = source.replace(/\bunique\b(?! sort)/g, 'unique sort');
if (process.argv.includes('--trace')) source = source.replace('  Par = Out unique',
    '  M print\n  Pairs print\n  Par = Out unique').replace('  End = array',
    '  (Lev len) print\n  End = array');
const diagnostics = new RuntimeDiagnostics();
const start = performance.now();
const runtime = new Interpreter(line => {
    process.stderr.write(JSON.stringify({ ms: performance.now() - start, out: line }) + '\n');
}, { compilation: !process.argv.includes('--reference') });
try {
    if (process.argv.includes('--diag')) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const ms = performance.now() - start;
    const answer = String(runtime.variables.get('Answer'));
    const golden = { 1: '1', 2: '3', 3: '7', 10: '2525', 12: '15463', 15: '241519', 18: '3857447' }[count];
    if (golden) assert.equal(answer, golden);
    console.log(JSON.stringify({ count, variant, reference: process.argv.includes('--reference'), ms,
        rss: process.resourceUsage().maxRSS / 1024, answer,
        sourceHash: createHash('sha256').update(source).digest('hex'),
        ...(process.argv.includes('--diag') ? { diagnostics } : {}) }));
} finally { runtime.dispose(); }
