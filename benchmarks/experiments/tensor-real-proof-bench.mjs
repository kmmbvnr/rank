import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const steps = Number(process.env.STEPS ?? 1000);
const samples = Number(process.env.SAMPLES ?? 5);
const size = 50000;
if (process.argv[2] === 'probe') {
    const { Interpreter, RuntimeDiagnostics } = await import('../../packages/interpreter/out/index.js');
    const { typedArray } = await import('../../packages/interpreter/out/array-storage.js');
    const runtime = new Interpreter();
    try {
        runtime.execute('use sequences');
        const shape = process.argv[3] === 'matrix-loop' ? [200, 250] : [size];
        for (const name of ['A', 'B']) runtime.variables.set(name,
            typedArray(Float64Array.from({ length: size }, (_, i) => i % 31 + 1), shape));
        const update = 'A += B * 0.005';
        for (let i = 0; i < 100; i++) runtime.execute(update);
        const diagnostics = new RuntimeDiagnostics();
        const start = performance.now();
        diagnostics.run(() => {
            if (process.argv[3] === 'vector-execute') {
                for (let i = 0; i < steps; i++) runtime.execute(update);
            } else runtime.execute(`for N in 1 to ${steps}\n  ${update}\nend`);
        });
        const ms = performance.now() - start;
        console.log(JSON.stringify({ ms, scans: diagnostics.elementTypeScans,
            scannedCells: diagnostics.elementTypeScannedCells, reuse: diagnostics.reusedTensorBuffers,
            sum: runtime.execute('A sum') }));
    } finally { runtime.dispose(); }
} else {
    // Run after building, with no concurrent process using this checkout's out/.
    // Only compiled output is replaced; source is unchanged and output restored.
    const file = new URL('../../packages/interpreter/out/tensor-kernel.js', import.meta.url);
    const current = readFileSync(file, 'utf8');
    const previous = current.replaceAll("typedArray(items, shape, undefined, 'real')", 'typedArray(items, shape)');
    if (previous === current) throw new Error('Build the real-proof change first');
    const results = [];
    try {
        for (const workload of ['vector-execute', 'vector-loop', 'matrix-loop']) {
            for (let sample = 0; sample < samples; sample++) {
                for (const variant of sample % 2 ? ['proof', 'no-proof'] : ['no-proof', 'proof']) {
                    writeFileSync(file, variant === 'proof' ? current : previous);
                    const result = JSON.parse(execFileSync(process.execPath,
                        [fileURLToPath(import.meta.url), 'probe', workload], { encoding: 'utf8' }));
                    if (result.reuse !== steps) throw new Error('lost reuse');
                    results.push({ workload, sample, variant, ...result });
                }
            }
        }
    } finally { writeFileSync(file, current); }
    for (const workload of ['vector-execute', 'vector-loop', 'matrix-loop']) {
        if (new Set(results.filter(row => row.workload === workload).map(row => row.sum)).size !== 1)
            throw new Error('result mismatch');
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, steps, samples, size,
        comparison: 'same primitive-specialized emitter, with/without preserved real result proof', results }, null, 2));
}
