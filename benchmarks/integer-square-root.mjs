import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const flag = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const input = 'Xs = 1 to 5000000 array\nYs = 31250000000000000 - Xs * Xs';
if (process.argv.includes('--worker')) {
    const { Interpreter, isRankArray } = await import(pathToFileURL(resolve(flag('runtime'))).href);
    const runtime = new Interpreter();
    try {
        runtime.execute('use numbers\nuse sequences');
        let start = performance.now();
        runtime.execute(input);
        const setupMs = performance.now() - start;
        start = performance.now();
        let answer;
        if (flag('workload') === 'materialize') {
            const roots = runtime.execute('Ys isqrt');
            assert.ok(isRankArray(roots));
            const items = roots.items;
            const operationMs = performance.now() - start;
            assert.equal(items.length, 5000000);
            for (const i of [0, 1, 999, 2499999, 4999999]) {
                const n = 31250000000000000n - BigInt(i + 1) ** 2n, r = items[i];
                assert.equal(typeof r, 'bigint');
                assert.ok(r * r <= n && (r + 1n) * (r + 1n) > n);
            }
            answer = items.reduce((a, b) => a + b, 0n);
            assert.equal(answer, 883765608673157n);
            console.log(JSON.stringify({ setupMs, operationMs, answer: String(answer) }));
        } else {
            answer = runtime.execute('Ys isqrt sum');
            const operationMs = performance.now() - start;
            assert.equal(answer, 883765608673157n);
            console.log(JSON.stringify({ setupMs, operationMs, answer: String(answer) }));
        }
    } finally { runtime.dispose(); }
} else {
    const candidate = new URL('../packages/interpreter/out/index.js', import.meta.url).pathname;
    const baseline = flag('baseline');
    assert.ok(baseline, 'pass --baseline=/absolute/path/to/baseline/packages/interpreter/out/index.js');
    const trials = Number(flag('trials') ?? 3);
    assert.ok(Number.isInteger(trials) && trials > 0);
    const git = (runtime, ...args) => execFileSync('git', ['-C', dirname(runtime), ...args], { encoding: 'utf8' }).trim();
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, trials,
        inputSha256: createHash('sha256').update(input).digest('hex'),
        baseline: { runtime: baseline, commit: git(baseline, 'rev-parse', 'HEAD'), tree: git(baseline, 'rev-parse', 'HEAD^{tree}') },
        candidate: { runtime: candidate, commit: git(candidate, 'rev-parse', 'HEAD'), tree: git(candidate, 'rev-parse', 'HEAD^{tree}') },
        driverSha256: createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex') }));
    for (let trial = 0; trial < trials; trial++) {
        for (const workload of ['sum', 'materialize']) {
            const modes = trial % 2 ? [['candidate', candidate], ['baseline', baseline]] : [['baseline', baseline], ['candidate', candidate]];
            for (const [mode, runtime] of modes) {
                const start = performance.now();
                const child = spawnSync(process.execPath, [import.meta.filename, '--worker', `--runtime=${runtime}`, `--workload=${workload}`],
                    { encoding: 'utf8', timeout: 180000 });
                const coldMs = performance.now() - start;
                assert.equal(child.status, 0, child.stderr || child.stdout || String(child.error));
                console.log(JSON.stringify({ mode, workload, trial, coldMs, ...JSON.parse(child.stdout) }));
            }
        }
    }
}
