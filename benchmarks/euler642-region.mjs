import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const mode = process.argv[2] ?? 'on';
const n = process.argv[3] ?? '1000000000';
assert.ok(['on', 'off'].includes(mode));
const answers = { 10000: 10118280n, 1000000000: 895017934n, 201820182018: 631499044n };
assert.ok(n in answers);
const source = readFileSync(new URL('../demos/euler/642_largestprimefactors.ra', import.meta.url), 'utf8')
    .replace('N integer = 201820182018', `N integer = ${n}`);
const runtime = new Interpreter(() => {}, { integerLoopCompilation: mode === 'on' });
const d = new RuntimeDiagnostics();
try {
    const start = performance.now(), cpu = process.cpuUsage();
    d.run(() => runtime.execute(source));
    const ms = performance.now() - start, used = process.cpuUsage(cpu);
    const answer = (runtime.variables.get('Answer') ?? runtime.lastResult);
    assert.equal(answer, answers[n]);
    assert.equal(d.compiledLoops, mode === 'on' ? 2 : 0);
    console.log(JSON.stringify({ mode, n, ms, cpuMs: (used.user + used.system) / 1000,
        answer: String(answer), compiledLoops: d.compiledLoops, numberLoops: d.numberLoops,
        fusedArrayUpdates: d.fusedArrayUpdates,
        rssMiB: process.resourceUsage().maxRSS / 1024 }));
} finally { runtime.dispose(); }
