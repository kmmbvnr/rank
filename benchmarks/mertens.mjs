// Build first: npx tsc -b tsconfig.build.json
// Timings: node benchmarks/mertens.mjs --samples=3
// CPU profile: node benchmarks/mertens.mjs --profile=/tmp/mertens.cpuprofile
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const { values } = parseArgs({ options: {
    n: { type: 'string', default: '10000000000' },
    limit: { type: 'string', default: '4641589' },
    samples: { type: 'string', default: '3' },
    compiled: { type: 'string', default: 'true' },
    expected: { type: 'string' },
    profile: { type: 'string' },
    diagnostics: { type: 'boolean', default: false },
    worker: { type: 'boolean', default: false },
} });
const n = Number(values.n), limit = Number(values.limit), samples = Number(values.samples);
for (const value of [n, limit, samples]) assert(Number.isSafeInteger(value) && value > 0);
assert(['true', 'false'].includes(values.compiled));
const expected = values.expected ?? {
    2: '5', 5: '293', 10: '86195', 20: '227991891',
    1000000: '585561545', 100000000: '345566857', 10000000000: '268457129',
}[n];
assert(expected !== undefined, 'supply --expected for other inputs');
const source = readFileSync(new URL('../demos/euler/319_bounded.ra', import.meta.url), 'utf8');

if (values.worker) {
    const runtime = new Interpreter(() => {}, {
        args: [`--n=${n}`, `--limit=${limit}`], compilation: values.compiled === 'true',
    });
    const diagnostics = new RuntimeDiagnostics();
    let session;
    try {
        if (values.profile) {
            session = new Session();
            session.connect();
            await session.post('Profiler.enable');
            await session.post('Profiler.start');
        }
        const cpu = process.cpuUsage(), start = performance.now();
        if (values.diagnostics) diagnostics.run(() => runtime.execute(source));
        else runtime.execute(source);
        const ms = performance.now() - start, used = process.cpuUsage(cpu);
        const answer = String(runtime.variables.get('Answer'));
        assert.equal(answer, expected);
        if (session) {
            const { profile } = await session.post('Profiler.stop');
            writeFileSync(values.profile, JSON.stringify(profile));
        }
        console.log(JSON.stringify({ answer, ms, cpuMs: (used.user + used.system) / 1000,
            rssMb: process.memoryUsage().rss / 1048576,
            ...(values.diagnostics ? { diagnostics } : {}),
        }));
    } finally { session?.disconnect(); runtime.dispose(); }
} else {
    const records = [];
    // Profiling and instrumentation use separate runs from ordinary timings.
    for (let sample = 0; sample < (values.profile || values.diagnostics ? 1 : samples); sample++) {
        const args = [fileURLToPath(import.meta.url), '--worker', `--n=${n}`, `--limit=${limit}`,
            `--compiled=${values.compiled}`, `--expected=${expected}`];
        if (values.profile) args.push(`--profile=${values.profile}`);
        if (values.diagnostics) args.push('--diagnostics');
        const child = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 600000 });
        assert.equal(child.status, 0, child.error?.message ?? child.stderr);
        records.push({ sample, ...JSON.parse(child.stdout) });
    }
    const times = records.map(record => record.ms).sort((a, b) => a - b);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, n, limit,
        compilation: values.compiled === 'true',
        method: 'fresh processes; timings include parsing and execution, exclude interpreter construction; RSS is total process memory after execution, not peak',
        instrumented: Boolean(values.profile || values.diagnostics),
        records, medianMs: times[Math.floor(times.length / 2)],
    }, null, 2));
}
