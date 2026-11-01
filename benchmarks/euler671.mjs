import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interpreter } from '../packages/interpreter/out/index.js';

const mode = process.argv[2] ?? 'matmul';
assert.ok(['matmul', 'broadcast'].includes(mode));
let source = readFileSync(new URL(
    '../demos/euler/671_colouringloop.ra',
    import.meta.url), 'utf8');
if (mode === 'broadcast') source = source.replace(
    '  Vm = Vm matmul Am mod P',
    '  Vq = Vm reshape Nr Nv 1\n'
    + '  Vt = Vq * (Am reshape 1 Nv Nv) mod P\n'
    + '  Vm = Vt sum axis 1 mod P');
const runtime = new Interpreter(() => {});
try {
    const start = performance.now();
    const cpu = process.cpuUsage();
    runtime.execute(source);
    const ms = performance.now() - start;
    const used = process.cpuUsage(cpu);
    const answer = String(runtime.variables.get('Answer'));
    assert.equal(answer, '946106780');
    console.log(JSON.stringify({ mode, ms,
        cpuMs: (used.user + used.system) / 1000,
        rssMiB: process.resourceUsage().maxRSS / 1024,
        answer }));
} finally {
    runtime.dispose();
}
