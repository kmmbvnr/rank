import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map(argument => {
    const match = /^--(baseline|samples|worker)=(.+)$/.exec(argument);
    if (!match) throw Error(`Unknown option: ${argument}`);
    return [match[1], match[2]];
}));
const source = readFileSync(resolve(root, 'demos/euler/345_matrixsum.ra'), 'utf8');
if (options.worker) {
    const { Interpreter, parse } = await import(pathToFileURL(resolve(options.worker, 'packages/interpreter/out/index.js')));
    const output = [];
    const runtime = new Interpreter(value => output.push(value));
    try {
        const program = parse(source);
        const start = performance.now();
        runtime.executeProgram(program, []);
        const executionMs = performance.now() - start;
        assert.deepEqual(output, ['13938']);
        console.log(JSON.stringify({ executionMs }));
    } finally { runtime.dispose(); }
} else {
    const samples = Number(options.samples ?? 5);
    assert(Number.isSafeInteger(samples) && samples >= 3);
    const checkouts = { candidate: root, ...options.baseline ? { baseline: resolve(options.baseline) } : {} };
    const report = { node: process.version, cpu: cpus()[0]?.model, samples,
        sourceHash: createHash('sha256').update(source).digest('hex'), expected: '13938',
        timing: 'fresh processes, alternating order; execution excludes parsing; process includes startup and parsing',
        versions: {} };
    for (const [name, checkout] of Object.entries(checkouts)) {
        report.versions[name] = {
            revision: execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
            dirty: Boolean(execFileSync('git', ['-C', checkout, 'status', '--porcelain'], { encoding: 'utf8' }).trim()),
            executionMs: [], processMs: [],
        };
    }
    for (let sample = 0; sample < samples; sample++) {
        const entries = Object.entries(checkouts);
        if (sample % 2) entries.reverse();
        for (const [name, checkout] of entries) {
            const start = performance.now();
            const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${checkout}`],
                { encoding: 'utf8', timeout: 30000 });
            const processMs = performance.now() - start;
            assert.ifError(child.error);
            assert.equal(child.status, 0, child.stderr);
            report.versions[name].executionMs.push(JSON.parse(child.stdout).executionMs);
            report.versions[name].processMs.push(processMs);
        }
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    for (const version of Object.values(report.versions)) {
        version.medianExecutionMs = median(version.executionMs);
        version.medianProcessMs = median(version.processMs);
    }
    if (report.versions.baseline) report.speedup = {
        execution: report.versions.baseline.medianExecutionMs / report.versions.candidate.medianExecutionMs,
        process: report.versions.baseline.medianProcessMs / report.versions.candidate.medianProcessMs,
    };
    console.log(JSON.stringify(report, null, 2));
}
