// Build first. Each sample runs in a fresh process; parsing is excluded.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(argument => {
    const match = /^--(checkout|case|size|samples|timeout|worker)=(.+)$/.exec(argument);
    assert(match, `Unknown argument: ${argument}`);
    return [match[1], match[2]];
}));
const kind = args.case ?? 'ants', size = Number(args.size ?? (kind === 'ants' ? 10 : 100000));
assert(['ants', 'index'].includes(kind));
assert(Number.isSafeInteger(size) && size > 0);
const checkout = resolve(args.checkout ?? root);
if (args.worker) {
    const { Interpreter, parse } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
    const expected = kind === 'index' ? String(BigInt(size) * BigInt(size + 1) / 2n + 9007199254740993n)
        : new Map([[2, '2'], [3, '0'], [4, '88'], [6, '207408'], [8, '22902801416'], [10, '112398351350823112']]).get(size);
    assert(expected, 'No oracle for this input');
    const source = kind === 'ants'
        ? readFileSync(new URL('../demos/euler/393_ants.ra', import.meta.url), 'utf8')
            .replace('arg N integer = 10', `arg N integer = ${size}`)
        : `use algo\nCache = new index\nCache 0 = 9007199254740993\nfor I in 1 to ${size}\n Cache 0 += I\nend\nAnswer = Cache 0`;
    const output = [], runtime = new Interpreter(value => output.push(value));
    try {
        const program = parse(source), start = performance.now();
        runtime.executeProgram(program, []);
        const executionMs = performance.now() - start, answer = String(runtime.variables.get('Answer'));
        assert.equal(answer, expected);
        if (kind === 'ants') assert.deepEqual(output, [expected]);
        console.log(JSON.stringify({ executionMs, answer, sourceHash: createHash('sha256').update(source).digest('hex'), peakRssKiB: process.resourceUsage().maxRSS }));
    } finally { runtime.dispose(); }
} else {
    const samples = Number(args.samples ?? 3), timeout = Number(args.timeout ?? 60000);
    assert(Number.isSafeInteger(samples) && samples > 0);
    const results = [];
    for (let trial = 0; trial < samples; trial++) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker=true',
            `--checkout=${checkout}`, `--case=${kind}`, `--size=${size}`], { encoding: 'utf8', timeout });
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stderr);
        results.push(JSON.parse(child.stdout));
    }
    const median = [...results].sort((a, b) => a.executionMs - b.executionMs)[Math.floor(samples / 2)].executionMs;
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, checkout, kind, size,
        timing: 'fresh processes; execution excludes parsing', results, medianExecutionMs: median }));
}
