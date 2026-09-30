// npm run bench:tables [samples]
// The shapes behind the yearly closed form of Dyalog 2010 task 6 (#17): a
// Years x Sims table scanned down its years, and a Years x Sims x 12 broadcast
// summed over its months. Each case runs in its own process.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../packages/cli/bin/cli.js', import.meta.url));
const samples = Number(process.argv[2] ?? 3);
assert(Number.isSafeInteger(samples) && samples > 0);
const dir = mkdtempSync(join(tmpdir(), 'rank-tables-'));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const header = [
    'use io', 'use sequences', 'use numbers',
    'Years = 30', 'Sims = 10000',
    'Cells = (0 till (Years * Sims)) (array Years Sims) reshape',
];
const cases = {
    'startup only': [],
    'running product down the years': [
        'Factor = 1.0 + Cells * 0.0000001',
        'Balance = Factor scan * axis 0',
        'Balance sum print',
    ],
    'running maximum down the years': [
        'Path = Cells * 0.5 % 7.0',
        'Highest = Path scan max axis 0',
        'Highest sum print',
    ],
    'broadcast over the months, summed': [
        'Cube = (0 till (Years * Sims)) (array Years Sims 1) reshape',
        'Rate = Cube * 0.0000001 + 0.004',
        'Pay = Cube * 0.0000002 + 0.003',
        'Month = (0 till 12) (array 1 1 12) reshape',
        'Weight = 1.0 + Month * 0.01',
        'Power = (1.0 + Rate) ** Month',
        'Flow = ((Rate - Pay) * Power + Pay) * Weight',
        'Total = Flow sum axis 2',
        'Total sum print',
    ],
};

let baseline = 0;
for (const [name, body] of Object.entries(cases)) {
    const file = join(dir, 'case.ra');
    writeFileSync(file, [...header, ...body, '1 print'].join('\n') + '\n');
    const times = [];
    let output = '';
    for (let i = 0; i < samples; i++) {
        const start = performance.now();
        const child = spawnSync(process.execPath, [cli, file], { encoding: 'utf8' });
        times.push(performance.now() - start);
        assert.equal(child.status, 0, child.stderr);
        output = child.stdout.trim().split('\n').slice(0, -1).join(' ');
    }
    const time = median(times);
    if (!body.length) baseline = time;
    console.log(`${name.padEnd(36)} ${time.toFixed(0).padStart(6)} ms  (${Math.max(0, time - baseline).toFixed(0)} ms of work)  ${output}`);
}
