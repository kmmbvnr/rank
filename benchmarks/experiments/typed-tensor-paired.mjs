import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import ts from 'typescript';
import { parse, RuntimeDiagnostics } from '../../packages/interpreter/out/index.js';
import { compileTensorKernel } from '../../packages/interpreter/out/tensor-kernel.js';
import { ownedStorage } from '../../packages/interpreter/out/array-storage-state.js';
import { typedArray, readArrayItem } from '../../packages/interpreter/out/array-storage.js';

// Only the emitter differs. Both modules share this checkout's runtime/storage.
const revision = process.env.BASELINE ?? '9099399f';
const baselinePath = new URL('../../packages/interpreter/out/tensor-kernel-baseline.js', import.meta.url);
const source = execFileSync('git', ['show', `${revision}:packages/interpreter/src/tensor-kernel.ts`], { encoding: 'utf8' });
fs.writeFileSync(baselinePath, ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
}).outputText);
const baseline = (await import(baselinePath.href)).compileTensorKernel;
const steps = Number(process.env.STEPS ?? 500), samples = Number(process.env.SAMPLES ?? 7), size = 50000;
const results = [];
for (const kind of ['float64', 'int32', 'int64']) {
    for (const shape of [[size], [200, 250]]) {
        const rows = [baseline, compileTensorKernel].map((compile, index) => {
            const real = kind === 'float64';
            const make = () => kind === 'int64' ? BigInt64Array.from({ length: size }, (_, i) => 10000000000n + BigInt(i % 31))
                : (real ? Float64Array : Int32Array).from({ length: size }, (_, i) => i % 31 + 1);
            const values = new Map();
            const reset = () => {
                values.set('A', typedArray(make(), shape));
                values.set('B', typedArray(make(), shape));
                // No external aliases. Interpreter binding normally records this owner.
                ownedStorage.get(values.get('A')).owners = 1;
            };
            reset();
            const kernel = compile(parse(real ? 'A += B * 0.005' : 'A += B * 2 + 1').statements[0], {
                lookup: name => values.get(name), builtin: () => true,
            });
            const step = () => {
                const result = kernel.run();
                if (result === undefined) throw new Error('unexpected fallback');
                ownedStorage.get(result).owners = 1;
                values.set('A', result);
            };
            for (let i = 0; i < 200; i++) step();
            return { variant: index ? 'specialized' : 'baseline', values, reset, step, timingsMs: [], sums: [], reuse: [], rangeScans: [], source: kernel.source };
        });
        for (let sample = 0; sample < samples; sample++) {
            for (const row of sample % 2 ? [...rows].reverse() : rows) {
                row.reset();
                for (let i = 0; i < 20; i++) row.step();
                global.gc?.();
                const diagnostics = new RuntimeDiagnostics();
                const start = performance.now();
                diagnostics.run(() => { for (let i = 0; i < steps; i++) row.step(); });
                row.timingsMs.push(performance.now() - start);
                row.reuse.push(diagnostics.reusedTensorBuffers);
                row.rangeScans.push(diagnostics.tensorRangeScans);
                let sum = kind === 'float64' ? 0 : 0n;
                for (let i = 0; i < size; i++) sum += readArrayItem(row.values.get('A'), i);
                row.sums.push(String(sum));
                if (diagnostics.reusedTensorBuffers !== steps) throw new Error('lost reuse');
            }
        }
        if (JSON.stringify(rows[0].sums) !== JSON.stringify(rows[1].sums)) throw new Error('result mismatch');
        const pairedSpeedups = rows[0].timingsMs.map((ms, i) => ms / rows[1].timingsMs[i]);
        const medianPairedSpeedup = [...pairedSpeedups].sort((a,b) => a-b)[Math.floor(samples / 2)];
        results.push({ kind, shape, pairedSpeedups, medianPairedSpeedup, variants: rows.map(({ variant, timingsMs, sums, reuse, rangeScans, source }) => ({
            variant, timingsMs, sums, reuse, rangeScans, source, medianMs: [...timingsMs].sort((a,b) => a-b)[Math.floor(samples / 2)],
        })) });
    }
}
fs.unlinkSync(baselinePath);
console.log(JSON.stringify({ revision, node: process.version, cpu: cpus()[0].model, steps, samples, size, results }, null, 2));
