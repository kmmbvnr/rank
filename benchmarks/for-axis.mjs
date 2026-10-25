import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

// Compare equivalent grid sweeps, including coordinate use and a value read.
// Build first: npx tsc -b tsconfig.build.json
const dimensions = (process.argv[2] ?? '200').split('x').map(Number);
const shape = dimensions.length === 1 ? [dimensions[0], dimensions[0]] : dimensions;
const samples = Number(process.argv[3] ?? 7);
assert(shape.length > 0 && shape.every(n => Number.isSafeInteger(n) && n > 0));
assert(Number.isSafeInteger(samples) && samples > 0);
const indices = shape.map((_, axis) => `I${axis}`);
const coordinates = indices.join(' ');
const axisList = shape.map((_, axis) => axis).join(' ');
const programs = {
    nested: indices.map((index, axis) => `for ${index} in 0 till N${axis}`).join('\n')
        + `\nTotal += (M ${coordinates}) + ${indices.join(' + ')}\n` + shape.map(() => 'end').join('\n'),
    axes: `for V ${coordinates} in M axis ${axisList}\n Total += V + ${indices.join(' + ')}\nend`,
};
const count = shape.reduce((n, size) => n * BigInt(size), 1n);
const expected = count * (2n + shape.reduce((n, size) => n + BigInt(size - 1), 0n)) / 2n;
for (const [name, loop] of Object.entries(programs)) {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter();
    try {
        runtime.execute(`use sequences
M = array shape ${shape.join(' ')} fill 1
fun sweep
 ${shape.map((_, axis) => `N${axis} = M len axis ${axis}`).join('\n')}
 Total = 0
 ${loop}
 return Total
end`);
        for (let i = 0; i < 3; i++) assert.equal(runtime.execute('sweep'), expected);
        const times = [];
        for (let i = 0; i < samples; i++) {
            const start = performance.now();
            assert.equal(runtime.execute('sweep'), expected);
            times.push(performance.now() - start);
        }
        diagnostics.run(() => assert.equal(runtime.execute('sweep'), expected));
        times.sort((a, b) => a - b);
        console.log(`${name}: median ${times[Math.floor(times.length / 2)].toFixed(3)} ms; ${shape.join('x')}; compiled executions ${diagnostics.compiledLoops}`);
    } finally { runtime.dispose(); }
}
