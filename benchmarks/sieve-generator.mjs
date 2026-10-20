import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Interpreter } from '../packages/interpreter/out/index.js';

// Run after: npx tsc -b tsconfig.build.json
// Each measurement gets its own process and two warmups. Never run alongside tests.
const variants = {
    before: { booleanSelectionCompilation: false, generatorLoopCompilation: false, loopYieldCompilation: false },
    boolean: { generatorLoopCompilation: false, loopYieldCompilation: false },
    generator: { booleanSelectionCompilation: false, loopYieldCompilation: false },
    both: { loopYieldCompilation: false },
    integer: {},
};
const worker = process.argv.find(arg => arg.startsWith('--worker='))?.slice(9);
if (worker) {
    assert(worker in variants);
    const source = readFileSync(new URL('../demos/euler/007_10001stprime.ra', import.meta.url), 'utf8')
        .replace('Answer print', 'Answer');
    let ms;
    for (let i = 0; i < 3; i++) {
        const runtime = new Interpreter(undefined, variants[worker]);
        try {
            const start = performance.now();
            const answer = runtime.execute(source);
            ms = performance.now() - start;
            assert.equal(answer, 104743n);
        } finally { runtime.dispose(); }
    }
    console.log(JSON.stringify({ ms }));
} else {
    const samples = Number(process.argv.find(arg => arg.startsWith('--samples='))?.slice(10) ?? 5);
    assert(Number.isSafeInteger(samples) && samples >= 3);
    const results = Object.fromEntries(Object.keys(variants).map(name => [name, []]));
    for (let sample = 0; sample < samples; sample++) {
        const order = Object.keys(variants);
        if (sample % 2) order.reverse();
        for (const name of order) {
            const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${name}`],
                { encoding: 'utf8', timeout: 60000 });
            assert.ifError(child.error);
            assert.equal(child.status, 0, child.stderr);
            results[name].push(JSON.parse(child.stdout).ms);
        }
        console.error(`Sample ${sample + 1}/${samples}`);
    }
    const medians = Object.fromEntries(Object.entries(results).map(([name, values]) =>
        [name, [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]]));
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
        measurement: 'parse + execution, fresh interpreter, two process-local warmups',
        expected: '104743', results, medians, speedup: medians.before / medians.integer }, null, 2));
}
