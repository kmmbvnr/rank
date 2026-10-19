// node benchmarks/sparse-dp.mjs [--sizes=100,1000,10000] [--timeout=30000]
// Build first: npm run langium:generate && npx tsc -b tsconfig.build.json
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = fileURLToPath(new URL('..', import.meta.url));
if (process.argv[2] === '--worker') {
    const { Interpreter, RuntimeDiagnostics } = await import('../packages/interpreter/out/index.js');
    const size = Number(process.argv[3]);
    const source = readFileSync(new URL('../demos/euler/400_fibtree.ra', import.meta.url), 'utf8')
        .replace('option K integer = 10000', `option K integer = ${size}`);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {});
    const cpu = process.cpuUsage(), start = performance.now();
    try {
        diagnostics.run(() => runtime.execute(source));
        console.log(JSON.stringify({ size, answer: String(runtime.variables.get('Answer')),
            executionMs: performance.now() - start, cpu: process.cpuUsage(cpu),
            peakRss: process.resourceUsage().maxRSS * 1024,
            states: runtime.variables.get('Memo')?.entries.size,
            diagnostics }));
    } finally { runtime.dispose(); }
} else {
    const args = Object.fromEntries(process.argv.slice(2).map(argument => {
        const match = /^--(sizes|timeout)=(.+)$/.exec(argument);
        assert(match, `Unknown argument: ${argument}`);
        return [match[1], match[2]];
    }));
    const sizes = (args.sizes ?? '100,1000,10000').split(',').map(Number);
    const timeout = Number(args.timeout ?? 30000);
    assert(sizes.every(size => Number.isSafeInteger(size) && size >= 1));
    assert(Number.isSafeInteger(timeout) && timeout > 0);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, timeout,
        timing: 'Fresh process per size; execution includes parse; cold wall includes imports/startup' }));
    for (const size of sizes) {
        const start = performance.now();
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', String(size)],
            { cwd: root, encoding: 'utf8', timeout });
        const coldMs = performance.now() - start;
        if (child.error?.code === 'ETIMEDOUT') {
            console.log(JSON.stringify({ size, timedOut: true, coldMs }));
            continue;
        }
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stderr);
        const result = JSON.parse(child.stdout);
        const expected = new Map([[5, '1'], [10, '17'], [100, '580893155023212545'],
            [1000, '867114317183878825'], [10000, '438505383468410633']]);
        if (expected.has(size)) assert.equal(result.answer, expected.get(size));
        console.log(JSON.stringify({ ...result, coldMs }));
    }
}
