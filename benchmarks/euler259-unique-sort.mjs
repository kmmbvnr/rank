// npx tsc -b tsconfig.build.json && node benchmarks/euler259-unique-sort.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Interpreter, parse, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const mode = process.argv[2];
if (!mode) {
    for (let trial = 1; trial <= 2; trial++) {
        for (const variant of ['separate', 'fused']) {
            const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), variant],
                { encoding: 'utf8' });
            assert.equal(child.status, 0, child.stderr);
            console.log(JSON.stringify({ trial, ...JSON.parse(child.stdout) }));
        }
    }
} else {
    assert.ok(['separate', 'fused'].includes(mode));
    let source = readFileSync(new URL('../demos/euler/259_reachablenumbers.ra', import.meta.url), 'utf8');
    if (mode === 'separate') source = source.replace('Sorted = Pool unique sort',
        'Distinct = Pool unique\n    Sorted = Distinct sort');
    const program = parse(source);
    const runtime = new Interpreter(() => {});
    const diagnostics = new RuntimeDiagnostics();
    try {
        const start = performance.now();
        diagnostics.run(() => runtime.executeProgram(program));
        const ms = performance.now() - start;
        assert.equal(runtime.variables.get('Answer'), 20101196798n);
        console.log(JSON.stringify({ mode, ms, answer: '20101196798',
            fused: diagnostics.numericUniqueSorts, rssAtEnd: process.memoryUsage().rss, node: process.version }));
    } finally { runtime.dispose(); }
}
