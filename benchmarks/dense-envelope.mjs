// Build both checkouts first: npx tsc -b tsconfig.build.json.
// node benchmarks/dense-envelope.mjs --baseline=/path/to/checkout --grids=10,25 --trials=3
// --grids=250 verifies the full Euler answer. Timing is not a CI deadline.
// --micro isolates dense rank-2 real reads and compound writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'demos/euler/314_mousemoon.ra'), 'utf8');

// Independent exhaustive DP, without an envelope or analytic intersections.
function reference(grid) {
    let ratio = 130.87;
    for (let round = 0; round < 12; round++) {
        const rows = Array.from({ length: grid + 1 }, () => []);
        for (let y = 0; y <= grid; y++) rows[0][y] = { area: 0, length: y };
        for (let i = 1; i <= grid; i++) for (let j = 0; j <= grid; j++) {
            let best = -Infinity;
            for (let x = 0; x < i; x++) for (let y = 0; y <= j; y++) {
                const previous = rows[x][y];
                const area = previous.area + (i - x) * (y + j) / 2;
                const length = previous.length + Math.hypot(i - x, j - y);
                const score = area - ratio * length;
                if (score > best) { best = score; rows[i][j] = { area, length }; }
            }
        }
        const best = rows[grid][grid], next = best.area / best.length;
        if (Math.abs(next - ratio) < 1e-12) return next;
        ratio = next;
    }
    return ratio;
}

if (option('worker')) {
    const micro = option('worker') === 'matrix', grid = micro ? 64 : Number(option('worker'));
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(option('root') ?? root, 'packages/interpreter/out/index.js')).href);
    const runtime = new Interpreter(() => {}, { compilation: !process.argv.includes('--reference') });
    const diagnostics = new RuntimeDiagnostics();
    const program = micro ? `M = array shape 64 64 fill 0.5
for Pass in 1 to 4
  for I in 0 till 64
    for J in 0 till 64
      M I J += I / 8.0 + J / 16.0
    end
  end
end
Answer = M 63 63` : source.replace('option Grid integer = 250', `option Grid integer = ${grid}`);
    try {
        runtime.execute('');
        const start = performance.now();
        if (process.argv.includes('--diagnostic')) diagnostics.run(() => runtime.execute(program));
        else runtime.execute(program);
        const ms = performance.now() - start, answer = runtime.variables.get('Answer');
        assert.equal(typeof answer, 'number');
        if (micro) assert.equal(answer, 47.75);
        if (grid <= 25) assert.ok(Math.abs(answer - reference(grid)) < 1e-10, String(answer));
        if (grid === 250) assert.equal(answer.toFixed(8), '132.52756426');
        console.log(JSON.stringify({ grid: micro ? 'matrix' : grid, ms, answer, maxRssMiB: process.resourceUsage().maxRSS / 1024,
            ...(process.argv.includes('--diagnostic') ? { diagnostics } : {}) }));
    } finally { runtime.dispose(); }
} else {
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
        timings: 'fresh processes; parser initialized; corrected candidate source used for both checkouts; diagnostics separate' }));
    const trials = Number(option('trials') ?? 3), timeout = Number(option('timeout') ?? 120000);
    assert.ok(Number.isInteger(trials) && trials > 0);
    const cases = process.argv.includes('--micro') ? ['matrix'] : (option('grids') ?? '10,25').split(',').map(Number);
    for (const grid of cases) {
        assert.ok(grid === 'matrix' || Number.isInteger(grid) && grid > 0);
        for (const [variant, checkout] of [['candidate', root], ...(option('baseline') ? [['baseline', option('baseline')]] : [])]) {
            const samples = [];
            for (let trial = 0; trial < trials + 1; trial++) {
                const diagnostic = trial === trials;
                const child = spawnSync(process.execPath, [import.meta.filename, `--worker=${grid}`, `--root=${checkout}`,
                    ...(diagnostic ? ['--diagnostic'] : []), ...(process.argv.includes('--reference') ? ['--reference'] : [])],
                { encoding: 'utf8', timeout });
                if (child.error?.code === 'ETIMEDOUT') {
                    console.log(JSON.stringify({ grid, variant, trial, diagnostic, timeoutMs: timeout }));
                    break;
                }
                assert.ifError(child.error); assert.equal(child.status, 0, child.stderr || child.stdout);
                const sample = JSON.parse(child.stdout);
                console.log(JSON.stringify({ variant, trial, diagnostic, ...sample }));
                if (!diagnostic) samples.push(sample.ms);
            }
            if (samples.length) console.log(JSON.stringify({ grid, variant,
                medianMs: samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)] }));
        }
    }
}
