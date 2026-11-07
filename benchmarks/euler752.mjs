import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
import { reference } from './euler752-investigation.mjs';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..'));
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const limit = Number(process.argv[2] ?? 1000000);
assert(Number.isInteger(limit) && limit >= 2 && limit <= 1000000);
const expected = reference(limit);
let source = readFileSync(process.env.RANK_SOURCE ?? `${root}/demos/euler/752_powers.ra`, 'utf8')
    .replace('arg Limit integer = 1000000', `Limit = ${limit}`);
if (process.env.STAGES) {
    for (const [line, stage] of [
        ['Bases = concat Primes (Bases Keep)', 'prime-powers'],
        [') axis 1\nCount = Mod len', 'candidates'],
        ['Root = Mat # 1 0', 'matrix-powers'],
        ['Orders Ids *= Need Keep .accumulate', 'orders'],
        ['Answer print', 'period-sum'],
    ]) {
        const at = line.startsWith(') axis') ? ') axis 1' : line;
        assert(source.includes(line));
        source = source.replace(at, `${at}\n"@stage:${stage}" print`);
    }
}
const diagnostics = process.env.DIAGNOSTICS ? new RuntimeDiagnostics() : undefined;
const stages = [];
let start, answer;
const runtime = new Interpreter(value => {
    const text = String(value);
    if (text.startsWith('@stage:')) {
        const memory = process.memoryUsage();
        const entry = { stage: text.slice(7), ms: performance.now() - start,
            rssMiB: memory.rss / 1048576, heapMiB: memory.heapUsed / 1048576,
            externalMiB: memory.external / 1048576, arrayBuffersMiB: memory.arrayBuffers / 1048576,
            ...(diagnostics && { costs: structuredClone(diagnostics.costs) }) };
        stages.push(entry); console.error(JSON.stringify(entry));
    } else { answer = text; if (process.env.TRACE) console.error(text); }
}, { compilation: process.argv[3] !== 'reference' });
const session = new Session();
try {
    if (process.env.PROFILE || process.env.HEAP_PROFILE) session.connect();
    if (process.env.PROFILE) { await session.post('Profiler.enable'); await session.post('Profiler.start'); }
    if (process.env.HEAP_PROFILE) await session.post('HeapProfiler.startSampling', {
        samplingInterval: 65536, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    start = performance.now(); const cpu = process.cpuUsage();
    if (diagnostics) diagnostics.run(() => runtime.execute(source)); else runtime.execute(source);
    assert.equal(answer, expected);
    const used = process.cpuUsage(cpu);
    console.log(JSON.stringify({ limit, answer, expected, ms: performance.now() - start,
        cpuMs: (used.user + used.system) / 1000, maxRssMiB: process.resourceUsage().maxRSS / 1024,
        node: process.version, arch: process.arch, stages,
        ...(diagnostics && { diagnostics }) }));
    if (process.env.PROFILE) { const { profile } = await session.post('Profiler.stop'); writeFileSync(process.env.PROFILE, JSON.stringify(profile)); }
    if (process.env.HEAP_PROFILE) { const { profile } = await session.post('HeapProfiler.stopSampling'); writeFileSync(process.env.HEAP_PROFILE, JSON.stringify(profile)); }
} finally { session.disconnect(); runtime.dispose(); }
