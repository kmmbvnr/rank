// Build first: npx tsc -b tsconfig.build.json
// --quick uses supplied small checkpoints; --baseline=/path/to/out/index.js compares an older runtime.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const source = readFileSync(new URL('../demos/euler/337_totientstairs.ra', import.meta.url), 'utf8');
const checkpoints = new Map([[10, 4n], [100, 82073668n], [10000, 73808307n],
    [1000000, 23116575n], [20000000, 85068035n]]);

if (option('worker')) {
    const limit = Number(option('worker'));
    assert.ok(checkpoints.has(limit));
    const { Interpreter, RuntimeDiagnostics } = await import(option('runtime')
        ? pathToFileURL(option('runtime')).href : '../packages/interpreter/out/index.js');
    const output = [];
    const runtime = new Interpreter(text => output.push(text), { args: [`--limit=${limit}`] });
    const diagnostics = new RuntimeDiagnostics(), instrumented = process.argv.includes('--diagnostic');
    try {
        const start = performance.now();
        if (instrumented) diagnostics.run(() => runtime.execute(source));
        else runtime.execute(source);
        const executeMs = performance.now() - start;
        const answer = output.join('').trim();
        assert.equal(answer, String(checkpoints.get(limit)));
        if (instrumented) {
            assert.equal(diagnostics.numberLoops, 2);
            assert.equal(diagnostics.numberLoopOverflows, 0);
            assert.equal(diagnostics.typedUnpacks, 0);
        }
        console.log(JSON.stringify({ limit, executeMs, answer: String(answer),
            rssAfterBytes: process.memoryUsage().rss, ...(instrumented ? { diagnostics } : {}) }));
    } finally { runtime.dispose(); }
} else {
    const trials = Number(option('trials') ?? 3);
    assert.ok(Number.isInteger(trials) && trials > 0);
    const limits = option('limits')?.split(',').map(Number)
        ?? (process.argv.includes('--quick') ? [10, 100, 10000] : [1000000, 20000000]);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        timing: 'fresh processes; unchanged demo; execution includes parsing; diagnostics separate; RSS is after execution, not peak' }));
    function sample(limit, runtime, diagnostic = false) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${limit}`,
            ...(runtime ? [`--runtime=${runtime}`] : []), ...(diagnostic ? ['--diagnostic'] : [])],
        { encoding: 'utf8', timeout: 180000 });
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stderr);
        return JSON.parse(child.stdout);
    }
    for (const limit of limits) {
        assert.ok(checkpoints.has(limit));
        for (const [variant, runtime] of [...(option('baseline') ? [['baseline', option('baseline')]] : []), ['candidate', undefined]]) {
            const samples = [];
            for (let trial = 0; trial < trials; trial++) {
                const result = sample(limit, runtime);
                samples.push(result.executeMs);
                console.log(JSON.stringify({ variant, trial, ...result }));
            }
            samples.sort((a, b) => a - b);
            console.log(JSON.stringify({ variant, limit, medianExecuteMs: samples[Math.floor(samples.length / 2)] }));
        }
        console.log(JSON.stringify({ variant: 'candidate', diagnostic: true, ...sample(limit, undefined, true) }));
    }
}
