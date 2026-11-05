import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run one fresh process per sample. RANK_ROOT selects an isolated runtime,
// RANK_SOURCE selects a solution, and PROFILE optionally saves a CPU profile.
const root = process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..');
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')));
if (process.argv.includes('--kernels')) {
    const { typedArray } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/array-storage.js')));
    const rows = 100000, width = 7;
    for (const compilation of [false, true]) for (const operation of ['pack', 'min-axis']) {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('use bits\nuse sequences');
            runtime.variables.set('Data', typedArray(Int32Array.from({ length: rows * width }, (_, i) => i % 8), [rows, width]));
            runtime.variables.set('Shift', typedArray(Int32Array.from({ length: width }, (_, i) => 6 * i)));
            const diagnostics = new RuntimeDiagnostics();
            const start = performance.now();
            diagnostics.run(() => runtime.execute(operation === 'pack'
                ? 'Result = Data shl Shift sum' : 'Result = Data min axis 1'));
            const ms = performance.now() - start;
            if (operation === 'pack') {
                let expected = 0n;
                for (let i = 0; i < rows * width; i++) expected += BigInt(i % 8) << BigInt(6 * (i % width));
                assert.equal(runtime.variables.get('Result'), expected);
            } else {
                const result = runtime.variables.get('Result');
                assert.deepEqual(result.shape, [rows]);
                assert.equal(result.items[0], 0n);
                assert.equal(result.items[1], 0n);
            }
            console.log(JSON.stringify({ operation, compilation, rows, ms, arch: process.arch, node: process.version,
                rssMiB: process.resourceUsage().maxRSS / 1024, compiledTensors: diagnostics.compiledTensors,
                cellsComputed: diagnostics.cellsComputed, typedUnpacks: diagnostics.typedUnpacks }));
        } finally { runtime.dispose(); }
    }
    process.exit(0);
}
const size = Number(process.argv[2] ?? 5);
const mode = process.argv[3] ?? 'compiled';
const sourceFile = process.env.RANK_SOURCE ?? resolve(root, 'demos/euler/701_randomconnectedarea.ra');
const source = readFileSync(sourceFile, 'utf8').replace(/arg (\w+) integer = 7/g, (_, name) => `${name} = ${size}`);
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference' });
const diagnostics = new RuntimeDiagnostics();
const session = new Session();
const answers = { 2: 1.875, 3: 3.64453125, 4: 5.7648773193359375, 5: 8.146968275308609, 6: 10.742542512147338, 7: 13.510998363327158 };
try {
    if (process.env.PROFILE) {
        session.connect();
        await session.post('Profiler.enable');
        await session.post('Profiler.start');
    }
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start;
    const answer = runtime.variables.get('Answer');
    if (size in answers) assert.equal(answer, answers[size]);
    if (process.env.PROFILE) {
        const { profile } = await session.post('Profiler.stop');
        writeFileSync(process.env.PROFILE, JSON.stringify(profile));
    }
    console.log(JSON.stringify({ size, mode, source: sourceFile, node: process.version, arch: process.arch,
        ms, answer: String(answer), total: String(runtime.variables.get('Sum') ?? runtime.variables.get('Tot')),
        rssMiB: process.resourceUsage().maxRSS / 1024, costs: diagnostics.costs,
        compiledTensors: diagnostics.compiledTensors, cowCopies: diagnostics.cowCopies,
        cowCopiedCells: diagnostics.cowCopiedCells, typedUnpacks: diagnostics.typedUnpacks,
        typedUnpackedCells: diagnostics.typedUnpackedCells }));
} finally { session.disconnect(); runtime.dispose(); }
