// Build with npx tsc -b tsconfig.build.json, then run this script.
// Compare a separately built checkout with --root /path/to/checkout.
// --euler includes the default Euler 74 demo and verifies its answer.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const rootAt = process.argv.indexOf('--root');
const root = rootAt < 0 ? resolve(import.meta.dirname, '..') : resolve(process.argv[rootAt + 1]);
const cases = {
    arithmetic: ['V * 3 + 1', 9678625588800n],
    divide: ['V // 100', 32260819461n],
    remainder: ['V mod 7', 7620480n],
    digits: ['V // 100 mod 10', 11430061n],
    named: ['V // 100\nE = D\nD = E mod 10', 11430061n],
};
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
if (process.argv.includes('--worker')) {
    const name = process.argv[process.argv.indexOf('--worker') + 1];
    const { Interpreter } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')).href);
    const runtime = new Interpreter(() => {});
    try {
        if (name === 'euler') {
            runtime.execute(readFileSync(resolve(root, 'demos/euler/074_digitchains.ra'), 'utf8'));
            assert.equal(runtime.variables.get('Answer'), 402n);
        } else {
            const [expression, expected] = cases[name];
            const value = runtime.execute(`use sequences\nV = 1 to 2540160 array\nV sum\nD = ${expression}\nD sum`);
            assert.equal(value, expected);
        }
        console.log(JSON.stringify({ maxRSSMiB: process.resourceUsage().maxRSS / 1024 }));
    } finally { runtime.dispose(); }
} else {
    const caseAt = process.argv.indexOf('--case');
    const names = caseAt >= 0 ? [process.argv[caseAt + 1]]
        : process.argv.includes('--euler') ? [...Object.keys(cases), 'euler'] : Object.keys(cases);
    const results = {};
    for (const name of names) {
        const samples = [];
        for (let run = 0; run < 3; run++) {
            const start = performance.now();
            const worker = spawnSync(process.execPath, [import.meta.filename, '--root', root, '--worker', name], { encoding: 'utf8' });
            const milliseconds = performance.now() - start;
            assert.equal(worker.status, 0, worker.stderr);
            samples.push({ milliseconds, ...JSON.parse(worker.stdout) });
        }
        results[name] = { samples, medianMs: median(samples.map(s => s.milliseconds)),
            medianMaxRSSMiB: median(samples.map(s => s.maxRSSMiB)) };
        console.error(`${name}: ${results[name].medianMs.toFixed(1)} ms`);
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, root, results }, null, 2));
}
