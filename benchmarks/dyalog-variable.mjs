// npm run bench:variable
// Dyalog 2010 tasks 5 and 6: the monthly Monte Carlo model and its
// yearly closed form, each run end to end through the CLI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../packages/cli/bin/cli.js', import.meta.url));
const samples = Number(process.argv[2] ?? 3);
assert(Number.isSafeInteger(samples) && samples > 0);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

for (const [name, source] of [['monthly', 'demos/dyalog/2010/005_variable.ra'],
    ['yearly', 'demos/dyalog/2010/006_fast.ra']]) {
    const times = [];
    let output;
    for (let i = 0; i < samples; i++) {
        const start = performance.now();
        const child = spawnSync(process.execPath, [cli, source], { cwd: root, encoding: 'utf8' });
        times.push(performance.now() - start);
        assert.equal(child.status, 0, child.stderr);
        output = child.stdout.trim();
    }
    console.log(`${name.padEnd(8)} ${median(times).toFixed(0).padStart(6)} ms  ${output}`);
}
