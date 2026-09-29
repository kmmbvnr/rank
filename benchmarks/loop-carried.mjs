// node benchmarks/loop-carried.mjs [lanes] [iterations]
// The case from #28: a loop rebinds an array from its own previous value, and
// the whole result is read at the end. Each variant runs in its own process.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../packages/cli/bin/cli.js', import.meta.url));
const lanes = Number(process.argv[2] ?? 10_000);
const iterations = Number(process.argv[3] ?? 360);
const dir = mkdtempSync(join(tmpdir(), 'rank-loop-'));

const variants = {
    'plain assignments': 'A = A * Growth + Flow',
    'copy on the carried array': 'A = (A * Growth + Flow) copy',
};
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

for (const [name, statement] of Object.entries(variants)) {
    const file = join(dir, 'case.ra');
    writeFileSync(file, [
        'use numbers',
        'use sequences',
        'use stats',
        'use io',
        `A = array shape ${lanes} fill 1.0`,
        `Flow = array shape ${lanes} fill 0.5`,
        'Growth = 1.001',
        `for Month in 0 till ${iterations}`,
        `  ${statement}`,
        'end',
        'A sum print',
    ].join('\n') + '\n');
    const times = [];
    let output = '';
    for (let i = 0; i < 3; i++) {
        const start = performance.now();
        const child = spawnSync(process.execPath, [cli, file], { encoding: 'utf8' });
        times.push(performance.now() - start);
        assert.equal(child.status, 0, child.stderr);
        output = child.stdout.trim();
    }
    console.log(`${name.padEnd(28)} ${median(times).toFixed(0).padStart(6)} ms  ${output}`);
}
