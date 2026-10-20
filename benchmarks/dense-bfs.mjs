// Build first: npx tsc -b packages/interpreter/tsconfig.json
// Fresh processes; timings include parsing and execution, but exclude imports.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const limit = Number(option('limit') ?? 10000);
const expected = new Map([[100, 11363107n], [1000, 111427232491n], [10000, 1111981904675169n]]);
assert.ok(expected.has(limit), '--limit must be 100, 1000 or 10000');

if (option('worker')) {
    const { Interpreter, RuntimeDiagnostics } = await import('../packages/interpreter/out/index.js');
    const mode = option('worker');
    assert.ok(['queue', 'array'].includes(mode));
    let source = readFileSync(new URL('../demos/euler/303_smalldigits.ra', import.meta.url), 'utf8')
        .replace('= 10000', `= ${limit}`);
    if (mode === 'array') {
        source = source.replace('Pending = new queue', 'Pending = array shape N fill 0\n  Head = 0\n  Tail = 0')
            .replace('Pending push R', 'Pending Tail = R\n      Tail += 1')
            .replace('Pending push Next', 'Pending Tail = Next\n        Tail += 1')
            .replace('for R in Pending', 'for Head less Tail\n    R = Pending Head\n    Head += 1');
    }
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    const instrumented = process.argv.includes('--diagnostic');
    try {
        const start = performance.now();
        if (instrumented) diagnostics.run(() => runtime.execute(source));
        else runtime.execute(source);
        const executeMs = performance.now() - start;
        assert.equal(runtime.variables.get('Answer'), expected.get(limit));
        if (instrumented) {
            assert.equal(diagnostics.loopElementScans, 0, 'reuse tracked scalar-kind evidence');
            assert.equal(diagnostics.compiledLoops, limit * 3, 'compile each entire BFS frontier');
        }
        console.log(JSON.stringify({ mode, limit, executeMs, answer: String(expected.get(limit)),
            ...(instrumented ? { diagnostics } : {}) }));
    } finally { runtime.dispose(); }
} else {
    const trials = Number(option('trials') ?? 3);
    assert.ok(Number.isInteger(trials) && trials > 0);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, trials, limit,
        timings: 'fresh processes; execute includes parsing; cold includes imports and disposal; diagnostics separate' }));
    for (const mode of ['queue', 'array']) {
        for (let trial = 0; trial <= trials; trial++) {
            const diagnostic = trial === trials;
            const start = performance.now();
            const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${mode}`,
                `--limit=${limit}`, ...(diagnostic ? ['--diagnostic'] : [])], { encoding: 'utf8', timeout: 240000 });
            assert.ifError(child.error);
            assert.equal(child.status, 0, child.stderr);
            console.log(JSON.stringify({ trial, diagnostic, coldMs: performance.now() - start, ...JSON.parse(child.stdout) }));
        }
    }
}
