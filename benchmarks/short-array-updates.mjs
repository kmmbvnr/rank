import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { PerformanceObserver } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const flag = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const n = Number(flag('n') ?? 250250);
assert.ok(Number.isSafeInteger(n) && n > 0);
const mode = flag('mode') ?? 'array-copy';
const setup = `use numbers
use sequences
M = 250
Mod = 10000000000000000
Cnt = array shape M fill 0
Cnt 0 = 1
Old = Cnt`;
const scalar = `for S in 0 till M
 Old S = Cnt S
end
for S in 0 till M
 From = (S + M - R) mod M
 Cnt S = (Old S + Old From) mod Mod
end`;
const array = `Head = Cnt take (M - R)
Tail = Cnt drop (M - R)
Cnt = (Cnt + concat Tail Head) mod Mod`;
const source = `for K in 1 to ${n}
 R = K K M powmod
 ${mode === 'scalar' ? scalar : array + (mode === 'array-copy' ? ' copy' : '')}
end
Cnt`;

if (process.argv.includes('--worker')) {
    assert.ok(['scalar', 'array', 'array-copy'].includes(mode));
    const { Interpreter } = await import(pathToFileURL(resolve(flag('runtime'))).href);
    const runtime = new Interpreter(undefined, { compilation: flag('compiled') !== 'false' });
    const gc = [];
    const observer = new PerformanceObserver(list => gc.push(...list.getEntries()));
    observer.observe({ entryTypes: ['gc'] });
    try {
        runtime.execute(setup);
        const cpu = process.cpuUsage(), start = performance.now();
        const value = runtime.execute(source);
        const items = value.items;
        const operationMs = performance.now() - start, used = process.cpuUsage(cpu);
        const answer = (items[0] - 1n + 10000000000000000n) % 10000000000000000n;
        if (n === 250250) assert.equal(answer, 1425480602091519n);
        if (n === 2500) assert.equal(answer, 3576981783379967n);
        assert.equal(items.length, 250);
        assert.ok(items.every(value => typeof value === 'bigint' && value >= 0n && value < 10000000000000000n));
        assert.equal(items.reduce((a, b) => a + b, 0n) % 10000000000000000n,
            (2n ** BigInt(n)) % 10000000000000000n);
        const heapUsed = process.memoryUsage().heapUsed;
        await new Promise(setImmediate);
        await new Promise(setImmediate);
        observer.disconnect();
        const during = gc.filter(entry => entry.startTime >= start && entry.startTime < start + operationMs);
        console.log(JSON.stringify({ mode, n, compiled: flag('compiled') !== 'false', operationMs,
            cpuMs: (used.user + used.system) / 1000, peakRssKB: process.resourceUsage().maxRSS,
            heapAfterBytes: heapUsed, gcCount: during.length, gcMs: during.reduce((a, b) => a + b.duration, 0), answer: String(answer),
            sourceSha256: createHash('sha256').update(setup + '\n' + source).digest('hex') }));
    } finally { observer.disconnect(); runtime.dispose(); }
} else {
    const runtime = new URL('../packages/interpreter/out/index.js', import.meta.url).pathname;
    const trials = Number(flag('trials') ?? 3);
    const modes = flag('modes')?.split(',') ?? ['array-copy', 'array', 'scalar'];
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, n, trials,
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        driverSha256: createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex') }));
    for (let trial = 0; trial < trials; trial++) for (const mode of trial % 2 ? [...modes].reverse() : modes) {
        const start = performance.now();
        const child = spawnSync(process.execPath, [
            ...(flag('heap') ? [`--max-old-space-size=${flag('heap')}`] : []), import.meta.filename, '--worker',
            `--runtime=${flag('runtime') ?? runtime}`, `--n=${n}`, `--mode=${mode}`, `--compiled=${flag('compiled') ?? 'true'}`,
        ], { encoding: 'utf8', timeout: 600000 });
        assert.equal(child.status, 0, child.stderr || child.stdout || String(child.error));
        console.log(JSON.stringify({ trial, coldMs: performance.now() - start, ...JSON.parse(child.stdout) }));
    }
}
