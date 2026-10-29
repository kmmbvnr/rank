import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const revision = process.env.BASELINE ?? '9099399f';
const samples = Number(process.env.SAMPLES ?? 5);
const steps = Number(process.env.STEPS ?? 500);
const file = new URL('../../packages/interpreter/out/tensor-kernel.js', import.meta.url);
const current = readFileSync(file, 'utf8');
const original = execFileSync('git', ['show', `${revision}:packages/interpreter/src/tensor-kernel.ts`], { encoding: 'utf8' });
const baseline = ts.transpileModule(original, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
}).outputText;
const runs = [];
// This runner temporarily replaces compiled output, never source. Do not run
// other programs from this checkout's out/ concurrently. Always restore it.
try {
    for (let sample = 0; sample < samples; sample++) {
        for (const variant of sample % 2 ? ['bounded', 'baseline'] : ['baseline', 'bounded']) {
            writeFileSync(file, variant === 'baseline' ? baseline : current);
            const result = JSON.parse(execFileSync(process.execPath,
                ['--expose-gc', fileURLToPath(new URL('./typed-tensor-bench.mjs', import.meta.url))],
                { encoding: 'utf8', env: { ...process.env, MODE: 'program', SAMPLES: '1', STEPS: String(steps) } }));
            runs.push({ sample, variant, ...result });
        }
    }
} finally { writeFileSync(file, current); }
for (let sample = 0; sample < samples; sample++) {
    const before = runs.find(run => run.sample === sample && run.variant === 'baseline');
    const after = runs.find(run => run.sample === sample && run.variant === 'bounded');
    for (let i = 0; i < before.results.length; i++) {
        if (JSON.stringify(before.results[i].sums) !== JSON.stringify(after.results[i].sums)) throw new Error('result mismatch');
        if (after.results[i].reuse.some(count => count !== steps)) throw new Error('lost reuse');
        if (after.results[i].rangeScans.some(count => count !== 0)) throw new Error('repeated range scans');
    }
}
console.log(JSON.stringify({ revision, samples, steps, runs }, null, 2));
