// Fresh processes; parsing/allocation included, startup/imports excluded.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const fixtures = {
    '379': ['379_lcmcount.ra', 'Limit', 100000000, '6261116500'],
    '411': ['411_uphillpaths.ra', 'Count', 20, '339984'],
    '459': ['459_flippinggame.ra', 'N', 10000, '2477885152'],
};
const runtimePath = resolve(option('runtime') ?? fileURLToPath(new URL('../packages/interpreter/out/index.js', import.meta.url)));
if (option('worker')) {
    const name = option('worker');
    assert.ok(fixtures[name]);
    const [file, parameter, defaultInput, defaultAnswer] = fixtures[name];
    const input = Number(option('input') ?? defaultInput);
    assert.ok(Number.isSafeInteger(input) && input > 0);
    const expected = option('expected') ?? (input === defaultInput ? defaultAnswer : undefined);
    assert.ok(expected, 'a nondefault input requires --expected from an independent check');
    const source = readFileSync(new URL(`../demos/euler/${file}`, import.meta.url), 'utf8')
        .replace(new RegExp(`option ${parameter} integer = [^\\n]+`), `${parameter} = ${input}`)
        .replace('Answer print', '');
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtimePath).href);
    const runtime = new Interpreter(() => {}), diagnostics = process.argv.includes('--diagnostics') ? new RuntimeDiagnostics() : undefined;
    try {
        const start = performance.now(), cpu = process.cpuUsage();
        const run = () => runtime.execute(source);
        if (diagnostics) diagnostics.run(run); else run();
        const executeMs = performance.now() - start, usage = process.cpuUsage(cpu);
        const answer = runtime.variables.get('Answer');
        assert.equal(String(answer), expected);
        console.log(JSON.stringify({ case: name, input, executeMs, cpuMs: (usage.user + usage.system) / 1000,
            maxRssKiB: process.resourceUsage().maxRSS, answer: String(answer),
            sourceSha256: createHash('sha256').update(source).digest('hex'), diagnostics }));
    } finally { runtime.dispose(); }
} else {
    const trials = Number(option('trials') ?? 3), timeout = Number(option('timeout') ?? 30000);
    assert.ok(Number.isInteger(trials) && trials > 0);
    assert.ok(Number.isInteger(timeout) && timeout > 0);
    const cases = (option('cases') ?? '379,411,459').split(',');
    assert.ok(cases.every(name => fixtures[name]));
    const runtimes = [...(option('baseline') ? [{ label: 'baseline', path: resolve(option('baseline')) }] : []),
        { label: option('label') ?? 'candidate', path: runtimePath }];
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, runtimes,
        timing: 'fresh sequential processes, alternating runtime order; execution includes parsing and allocation, excludes imports; diagnostic runs separate' }));
    const samples = new Map();
    for (let trial = 1; trial <= trials; trial++) for (const name of cases) {
        for (const runtime of trial % 2 ? runtimes : [...runtimes].reverse()) {
            const key = `${runtime.label}:${name}`, times = samples.has(key) ? samples.get(key) : [];
            if (times === null) continue;
            const args = [import.meta.filename, `--worker=${name}`, `--runtime=${runtime.path}`];
            for (const arg of ['input', 'expected']) if (option(arg)) args.push(`--${arg}=${option(arg)}`);
            if (process.argv.includes('--diagnostics')) args.push('--diagnostics');
            const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout });
            if (result.error?.code === 'ETIMEDOUT') {
                console.log(JSON.stringify({ runtime: runtime.label, case: name, trial, timeoutMs: timeout }));
                samples.set(key, null); continue;
            }
            assert.ifError(result.error);
            assert.equal(result.status, 0, result.stderr);
            const sample = { runtime: runtime.label, trial, ...JSON.parse(result.stdout) };
            times.push(sample.executeMs); samples.set(key, times); console.log(JSON.stringify(sample));
        }
    }
    for (const [key, times] of samples) if (times?.length === trials) console.log(JSON.stringify({ key,
        medianExecuteMs: times.sort((a, b) => a - b)[Math.floor(times.length / 2)] }));
}
