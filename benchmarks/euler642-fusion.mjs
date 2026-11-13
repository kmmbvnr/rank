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
const r = new Interpreter(() => {}, { tensorFusion: mode === 'on' }), d = new RuntimeDiagnostics();
try {
    const start = performance.now(), cpu = process.cpuUsage();
    d.run(() => r.execute(source));
    const ms = performance.now() - start, used = process.cpuUsage(cpu), answer = (r.variables.get('Answer') ?? r.lastResult);
    assert.equal(answer, answers[n]);
    assert.equal(d.compiledLoops, 2);
    assert.equal(d.fusedArrayRegions > 0, mode === 'on');
    console.log(JSON.stringify({ mode, n, ms, cpuMs: (used.user + used.system) / 1000,
        answer: String(answer), compiledLoops: d.compiledLoops,
        fusedArrayRegions: d.fusedArrayRegions, fusedArrayRegionCells: d.fusedArrayRegionCells,
        rssMiB: process.resourceUsage().maxRSS / 1024 }));
} finally { r.dispose(); }
