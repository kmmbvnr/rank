import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { Interpreter, RuntimeDiagnostics, parse } from '../../packages/interpreter/out/index.js';
import { ownedStorage } from '../../packages/interpreter/out/array-storage-state.js';
import { compileTensorKernel } from '../../packages/interpreter/out/tensor-kernel.js';
import { typedArray, readArrayItem } from '../../packages/interpreter/out/array-storage.js';

// Run each revision in a fresh process after building it. Setup and warmup are untimed.
const steps = Number(process.env.STEPS ?? 500);
const samples = Number(process.env.SAMPLES ?? 5);
const size = 50000;
const mode = process.env.MODE ?? 'interpreter';
const results = [];
for (const kind of ['float64', 'int32', 'int64']) {
    for (const shape of [[size], [200, 250]]) {
        const timings = [], sums = [], reuse = [];
        for (let sample = 0; sample < samples; sample++) {
            const runtime = new Interpreter();
            const diagnostics = new RuntimeDiagnostics();
            const real = kind === 'float64';
            const make = () => kind === 'int64' ? BigInt64Array.from({ length: size }, (_, i) => 10000000000n + BigInt(i % 31))
                : (real ? Float64Array : Int32Array).from({ length: size }, (_, i) => i % 31 + 1);
            try {
                runtime.execute('use sequences');
                const values = mode === 'kernel' ? new Map() : runtime.variables;
                values.set('A', typedArray(make(), shape));
                values.set('B', typedArray(make(), shape));
                // Standalone kernels have no interpreter binding layer to record ownership.
                if (mode === 'kernel') ownedStorage.get(values.get('A')).owners = 1;
                const source = real ? 'A += B * 0.005' : 'A += B * 2 + 1';
                const kernel = mode === 'kernel' ? compileTensorKernel(parse(source).statements[0], {
                    lookup: name => values.get(name), builtin: () => true,
                }) : undefined;
                const step = kernel ? () => {
                    const result = kernel.run();
                    if (result === undefined) throw new Error('unexpected fallback');
                    ownedStorage.get(result).owners = 1;
                    values.set('A', result);
                } : () => runtime.execute(source);
                for (let i = 0; i < 30; i++) step();
                global.gc?.();
                const start = performance.now();
                diagnostics.run(() => { for (let i = 0; i < steps; i++) step(); });
                timings.push(performance.now() - start);
                reuse.push(diagnostics.reusedTensorBuffers);
                const value = values.get('A');
                let sum = real ? 0 : 0n;
                for (let i = 0; i < size; i++) sum += readArrayItem(value, i);
                sums.push(String(sum));
            } finally { runtime.dispose(); }
        }
        if (new Set(sums).size !== 1) throw new Error('unstable result');
        results.push({ kind, shape, steps, timingsMs: timings, medianMs: [...timings].sort((a,b) => a-b)[Math.floor(samples/2)], sums, reuse });
    }
}
console.log(JSON.stringify({ mode, node: process.version, cpu: cpus()[0].model, size, samples, results }, null, 2));
