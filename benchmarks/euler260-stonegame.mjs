// Run: node benchmarks/euler260-stonegame.mjs 1000 original compiled
// RUNTIME may select an alternate built interpreter module.
import { readFileSync, appendFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(
    process.env.RUNTIME ?? 'packages/interpreter/out/index.js')).href);
const [top = '100', variant = 'original', mode = 'compiled'] = process.argv.slice(2);
assert(Number.isSafeInteger(+top) && +top >= 0);
assert(['original', 'short', 'break', 'skip', 'skipshort', 'bitset'].includes(variant));
assert(['compiled', 'reference'].includes(mode));
let source = readFileSync(new URL(variant === 'bitset'
    ? '../demos/euler/260_stonegame.ra' : './experiments/euler260-original.ra', import.meta.url), 'utf8')
    .replace('arg Top integer = 1000', `arg Top integer = ${top}`);
if (['short', 'skipshort'].includes(variant)) {
    source = source.replace(/      Hit = Pr[\s\S]*?      if Hit equal 0/,
        '      if Pr (X * W + Y) equal 0 and Pr (X * W + Z) equal 0'
        + ' and Pr (Y * W + Z) equal 0 and Dg ((Y - X) * W + Z) equal 0'
        + ' and Dg ((Z - X) * W + Y) equal 0 and Dg ((Z - Y) * W + X) equal 0'
        + ' and Eq ((Y - X) * W + Z - Y) equal 0');
}
if (['skip', 'skipshort'].includes(variant)) {
    source = source.replace('    for X in 0 to Y',
        '    if Pr (Y * W + Z) not equal 0\n      continue\n    end\n    for X in 0 to Y');
}
if (['break', 'skip', 'skipshort'].includes(variant)) {
    source = source.replace('        Eq ((Y - X) * W + Z - Y) = 1',
        '        Eq ((Y - X) * W + Z - Y) = 1\n        break');
}
const diagnostics = new RuntimeDiagnostics();
const output = [];
const runtime = new Interpreter(line => output.push(line), {
    compilation: mode !== 'reference',
    onIntegerLoopCompiled: process.env.DUMP
        ? code => appendFileSync(process.env.DUMP, `${code}\n// NEXT\n`) : undefined,
});
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start;
    const answer = String(runtime.variables.get('Answer'));
    const expected = { 0: 0, 1: 0, 2: 3, 3: 10, 5: 35, 10: 213, 15: 645, 100: 173895, 1000: 167542057 }[top];
    if (expected !== undefined) assert.equal(answer, String(expected));
    assert.deepEqual(output, [answer]);
    console.log(JSON.stringify({ top, variant, mode, ms, answer,
        rssMiB: process.resourceUsage().maxRSS / 1024, diagnostics }));
} finally {
    runtime.dispose();
}
