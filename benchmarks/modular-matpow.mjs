import assert from 'node:assert/strict';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';
import { arrayValues } from '../packages/interpreter/out/array-storage.js';

const mode = process.argv[2] ?? 'fused';
const n = BigInt(process.argv[3] ?? '1000000000000000000');
assert.ok(['exact', 'fused'].includes(mode) && n > 0n);
// Avoid accidentally constructing enormous exact integers.
assert.ok(mode !== 'exact' || n <= 16384n);
const m = 1000000007n;
let b = 32n, e = n - 1n, expected = 1n;
for (; e; e >>= 1n, b = b * b % m) if (e & 1n) expected = expected * b % m;
const source = `use linalg\nA = array shape 32 32 fill 1\n`
    + (mode === 'exact' ? `P = A matpow ${n}\nR = P mod ${m}` : `R = A matpow ${n} mod ${m}`);
const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now(), cpu = process.cpuUsage();
    diagnostics.run(() => runtime.execute(source));
    const cells = [...arrayValues(runtime.variables.get('R'))];
    const ms = performance.now() - start, used = process.cpuUsage(cpu);
    assert.equal(cells.length, 1024);
    cells.forEach(value => assert.equal(value, expected));
    assert.equal(diagnostics.modularMatrixPowers, mode === 'fused' ? 1 : 0);
    console.log(JSON.stringify({ mode, n: String(n), ms,
        cpuMs: (used.user + used.system) / 1000, answer: String(expected),
        fused: diagnostics.modularMatrixPowers,
        rssMiB: process.resourceUsage().maxRSS / 1024 }));
} finally { runtime.dispose(); }
