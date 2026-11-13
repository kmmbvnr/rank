import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interpreter } from '../packages/interpreter/out/index.js';

const nt = Number(process.argv[2] ?? 20000);
assert.ok(nt === 4000 || nt === 20000);
const source = readFileSync(new URL(
    '../demos/euler/667_movingpentagon.ra', import.meta.url), 'utf8')
    .replace('Nt integer = 20000', `Nt integer = ${nt}`);
const runtime = new Interpreter(() => {});
try {
    const start = performance.now();
    const cpu = process.cpuUsage();
    runtime.execute(source);
    const ms = performance.now() - start;
    const used = process.cpuUsage(cpu);
    const answer = (runtime.variables.get('Answer') ?? runtime.lastResult);
    assert.equal(answer, nt === 20000 ? '1.5276527929' : '1.5276530109');
    console.log(JSON.stringify({ nt, ms,
        cpuMs: (used.user + used.system) / 1000,
        rssMiB: process.resourceUsage().maxRSS / 1024, answer }));
} finally { runtime.dispose(); }
