import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const baselineIndex = process.argv.indexOf('--baseline');
const baseline = baselineIndex < 0 ? undefined : process.argv[baselineIndex + 1];
const interpreter = baseline && process.argv.includes('--worker')
    ? pathToFileURL(resolve(baseline, 'packages/interpreter/out/index.js'))
    : new URL('../packages/interpreter/out/index.js', import.meta.url);
const { Interpreter, createArraySnapshot, RuntimeDiagnostics } = await import(interpreter.href);

// Base-5 digit caps, as in Euler 322's no-carry product. The oracle enumerates
// complete integers independently of Rank's outer/reshape/filter pipeline.
function digits(caps) {
    let values = [0n], place = 1n;
    for (const cap of caps) {
        values = values.flatMap(low => Array.from({ length: cap + 1 }, (_, digit) => low + BigInt(digit) * place));
        place *= 5n;
    }
    return { values, place };
}
const low = digits([4, 0, 2, 1, 3, 2, 2]);
const high = digits([2, 4, 1, 3, 2, 2]);
const mask = 0b1010010101n;
const source = `use sequences
use bits
fun Lows Highs Place Mask carry_sum
  Grid = Lows (Highs * Place) outer +
  Flat = Grid reshape #
  Selected = Flat (Flat band Mask equal 0)
  return Selected sum
end
Lows Highs Place Mask carry_sum`;
const worker = process.argv.indexOf('--worker');
if (worker !== -1) {
    const tensorFusion = process.argv[worker + 1] === 'on';
    const runtime = new Interpreter(undefined, { tensorFusion });
    runtime.variables.set('Lows', createArraySnapshot(low.values));
    runtime.variables.set('Highs', createArraySnapshot(high.values));
    runtime.variables.set('Place', low.place);
    runtime.variables.set('Mask', mask);
    const boundary = source.lastIndexOf('\n');
    runtime.execute(source.slice(0, boundary));
    const diagnostics = new RuntimeDiagnostics();
    const before = process.memoryUsage();
    const started = performance.now();
    try {
        const answer = diagnostics.run(() => runtime.execute(source.slice(boundary + 1)));
        console.log(JSON.stringify({
            tensorFusion, candidates: low.values.length * high.values.length,
            answer: String(answer), elapsedMs: performance.now() - started,
            heapDeltaBytes: process.memoryUsage().heapUsed - before.heapUsed,
            peakRssKiB: process.resourceUsage().maxRSS,
            compiledTensors: diagnostics.compiledTensors, cellsComputed: diagnostics.cellsComputed,
        }));
    } finally { runtime.dispose(); }
} else {
    let expected = 0n;
    for (const a of low.values) for (const b of high.values) {
        const value = a + b * low.place;
        if ((value & mask) === 0n) expected += value;
    }
    const trials = Number(process.argv[2] ?? 3);
    assert(Number.isSafeInteger(trials) && trials > 0);
    console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, trials }));
    const modes = [{ name: 'reference', fusion: 'off' },
        ...(baseline ? [{ name: 'baseline', fusion: 'on', baseline }] : []), { name: 'candidate', fusion: 'on' }];
    for (const mode of modes) for (let trial = 0; trial < trials; trial++) {
        const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', mode.fusion,
            ...(mode.baseline ? ['--baseline', mode.baseline] : [])], { encoding: 'utf8', timeout: 60_000 });
        assert.equal(result.status, 0, result.stderr || result.error?.message);
        const sample = JSON.parse(result.stdout);
        assert.equal(sample.answer, String(expected));
        console.log(JSON.stringify({ mode: mode.name, trial, ...sample }));
    }
}
