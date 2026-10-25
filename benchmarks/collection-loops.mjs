import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { pathToFileURL } from 'node:url';

const flag = name => process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const demo = readFileSync(new URL('./fixtures/euler060-graph.ra', import.meta.url), 'utf8');
if (process.argv.includes('--worker')) {
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(flag('runtime')).href);
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    const measure = process.argv.includes('--diagnostics');
    try {
        runtime.execute('use graph\nuse sequences\n' + demo.slice(demo.indexOf('\nfun ')));
        const phases = {};
        for (const [name, source] of [
            ['seedBuild', 'Seed = 10000 build'],
            ['seedSearch', 'Upper = Seed min_five 50000\nUpper'],
            ['fullBuild', 'Full = Upper build'],
            ['fullSearch', 'Answer = Full min_five Upper\nAnswer'],
        ]) {
            const before = diagnostics.compiledLoops, start = performance.now();
            const value = measure ? diagnostics.run(() => runtime.execute(source)) : runtime.execute(source);
            phases[name] = { ms: performance.now() - start, loops: diagnostics.compiledLoops - before };
            if (name.endsWith('Search')) assert.equal(value, 26033n);
        }
        assert.equal(runtime.execute('Seed .primes len'), 1227n);
        assert.equal(runtime.execute('Answer'), 26033n);
        console.log(JSON.stringify({ phases, answer: 26033, ...(measure ? { diagnostics } : {}) }));
    } finally { runtime.dispose(); }
} else {
    const candidate = new URL('../packages/interpreter/out/index.js', import.meta.url).pathname;
    const baseline = flag('baseline');
    assert.ok(baseline, 'pass --baseline=/absolute/path/to/baseline/out/index.js');
    const trials = Number(flag('trials') ?? 3);
    assert.ok(Number.isInteger(trials) && trials > 0);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, candidate, baseline, trials,
        sourceSha256: createHash('sha256').update(demo).digest('hex') }));
    const sample = (mode, runtime, diagnostic, trial) => {
        const start = performance.now();
        const child = spawnSync(process.execPath, [import.meta.filename, '--worker', `--runtime=${runtime}`,
            ...(diagnostic ? ['--diagnostics'] : [])], { encoding: 'utf8', timeout: 180000 });
        const coldMs = performance.now() - start;
        assert.equal(child.status, 0, child.stderr || child.stdout || String(child.error));
        const result = JSON.parse(child.stdout);
        if (diagnostic && mode === 'candidate') {
            assert.ok(result.diagnostics.integerMembershipFilters > 0);
            assert.ok(result.diagnostics.compiledGraphAdds > 0);
        }
        console.log(JSON.stringify({ mode, diagnostic, trial, coldMs, ...result }));
    };
    for (let trial = 0; trial < trials; trial++) {
        const modes = trial % 2 ? [['candidate', candidate], ['baseline', baseline]] : [['baseline', baseline], ['candidate', candidate]];
        for (const [mode, runtime] of modes) sample(mode, runtime, false, trial);
    }
    for (const [mode, runtime] of [['baseline', baseline], ['candidate', candidate]]) sample(mode, runtime, true);
}
