import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
    const match = /^--(checkout|samples|worker|diagnostics)=(.+)$/.exec(arg);
    assert(match, `Unknown option: ${arg}`);
    return [match[1], match[2]];
}));
const root = resolve(options.checkout ?? fileURLToPath(new URL('..', import.meta.url)));
if (options.worker) {
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')));
    const runtime = new Interpreter(() => {});
    const source = readFileSync(resolve(root, 'demos/euler/375_subseqmin.ra'), 'utf8');
    const previous = source.indexOf('Prev ='), answer = source.indexOf('Full =');
    const phases = {};
    for (const [name, part] of [['generate', source.slice(0, previous)],
        ['previous', source.slice(previous, answer)], ['answer', source.slice(answer)]]) {
        const diagnostics = new RuntimeDiagnostics();
        const start = performance.now();
        if (options.diagnostics === 'true') diagnostics.run(() => runtime.execute(part));
        else runtime.execute(part);
        phases[name] = { ms: performance.now() - start,
            ...(options.diagnostics === 'true' ? { diagnostics } : {}) };
    }
    assert.equal(runtime.variables.get('Answer'), 7435327983715286168n);
    console.log(JSON.stringify({ phases, answer: String(runtime.variables.get('Answer')),
        maxRssMiB: process.resourceUsage().maxRSS / 1024 }));
    runtime.dispose();
} else {
    const samples = Number(options.samples ?? 3);
    assert(Number.isSafeInteger(samples) && samples >= 1);
    const results = [];
    for (let i = 0; i < samples; i++) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--checkout=${root}`,
            '--worker=true', `--diagnostics=${options.diagnostics ?? 'false'}`], { encoding: 'utf8', timeout: 60000 });
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stderr);
        const result = JSON.parse(child.stdout);
        results.push(result);
        console.error(JSON.stringify({ sample: i + 1, ...result }));
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    console.log(JSON.stringify({ revision: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        node: process.version, cpu: cpus()[0].model,
        timing: 'fresh processes, default parameters, source executed in three phases; parsing included; diagnostics opt-in',
        results, medianMs: Object.fromEntries(['generate', 'previous', 'answer'].map(name =>
            [name, median(results.map(result => result.phases[name].ms))])),
        medianTotalMs: median(results.map(result => Object.values(result.phases).reduce((sum, phase) => sum + phase.ms, 0))),
    }, null, 2));
}
