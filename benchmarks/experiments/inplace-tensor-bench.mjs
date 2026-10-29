import { performance } from 'node:perf_hooks';
import { Interpreter, RuntimeDiagnostics } from '../../packages/interpreter/out/index.js';

function runVectorUpdateBenchmark(steps = 2000, size = 50000) {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(undefined, { tensorFusion: true });

    runtime.execute([
        'use sequences',
        `Raw = 1 to ${size} array`,
        'Real = (Raw real rank 0) copy',
        'A = (Real * 1.0) copy',
        'V = (Real * 0.01) copy',
        'Rate = 0.005',
    ].join('\n'));

    // Warm up
    runtime.execute('A += V * Rate');

    if (global.gc) global.gc();
    const memBefore = process.memoryUsage().heapUsed;
    const start = performance.now();

    diagnostics.run(() => {
        for (let i = 0; i < steps; i++) {
            runtime.execute('A += V * Rate');
        }
    });

    const elapsed = performance.now() - start;
    const memAfter = process.memoryUsage().heapUsed;
    const memDiff = memAfter - memBefore;

    const sum = runtime.execute('A sum');

    return {
        steps,
        size,
        elapsedMs: elapsed.toFixed(2),
        perStepUs: ((elapsed / steps) * 1000).toFixed(2),
        memDiffBytes: memDiff,
        reusedTensorBuffers: diagnostics.reusedTensorBuffers,
        reusedTensorBufferCells: diagnostics.reusedTensorBufferCells,
        sum: String(sum),
    };
}

function runIntegerUpdateBenchmark(steps = 2000, size = 50000) {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(undefined, { tensorFusion: true });

    runtime.execute([
        'use sequences',
        `A = ((1 to ${size} array) copy)`,
        `B = ((2 to ${size + 1} array) copy)`,
    ].join('\n'));

    // Warm up
    runtime.execute('A += B * 2 + 1');

    if (global.gc) global.gc();
    const start = performance.now();

    diagnostics.run(() => {
        for (let i = 0; i < steps; i++) {
            runtime.execute('A += B * 2 + 1');
        }
    });

    const elapsed = performance.now() - start;
    const sum = runtime.execute('A sum');

    return {
        type: 'integer',
        steps,
        size,
        elapsedMs: elapsed.toFixed(2),
        perStepUs: ((elapsed / steps) * 1000).toFixed(2),
        reusedTensorBuffers: diagnostics.reusedTensorBuffers,
        reusedTensorBufferCells: diagnostics.reusedTensorBufferCells,
        sum: String(sum),
    };
}

console.log('Real vector benchmark:');
console.log(JSON.stringify(runVectorUpdateBenchmark(), null, 2));
console.log('Integer vector benchmark:');
console.log(JSON.stringify(runIntegerUpdateBenchmark(), null, 2));
