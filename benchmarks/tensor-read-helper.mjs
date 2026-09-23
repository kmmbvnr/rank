import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const mode = process.argv[2] ?? 'scalar';
assert(['scalar', 'builtin'].includes(mode));
const source = `fun bump X
 return X + 1
end
fun total B N
 Total = 0
 for I in 0 until N
  Total += B (I % 10000) + (I bump)
 end
 return Total
end
A = (1 to 10000) array
B = A * 2`;
const program = mode === 'builtin' ? source.replace('fun bump X\n return X + 1\nend', 'use text')
    .replace('(I bump)', '("A" codepoint)') : source;
const expected = mode === 'builtin' ? 1006600000n : 6000150000n;

const cases = [false, true].map(tensorReadHoisting => {
    const runtime = new Interpreter(undefined, { tensorReadHoisting });
    runtime.execute(program);
    const input = runtime.variables.get('B');
    input.items;
    const run = () => assert.equal(runtime.variables.get('total').call([input, 100000n]), expected);
    run();
    run();
    return { runtime, run, tensorReadHoisting, samples: [] };
});

for (let round = 0; round < 9; round++) {
    for (const item of round % 2 ? [...cases].reverse() : cases) {
        const start = performance.now();
        item.run();
        item.samples.push(performance.now() - start);
    }
}

const results = cases.map(item => {
    const diagnostics = new RuntimeDiagnostics();
    diagnostics.run(item.run);
    item.runtime.dispose();
    return {
        tensorReadHoisting: item.tensorReadHoisting,
        medianMs: [...item.samples].sort((a, b) => a - b)[4],
        hoistedReaders: diagnostics.hoistedReaders,
        compiledLoops: diagnostics.compiledLoops,
    };
});
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, mode,
    timing: 'warm calls, two warmups, nine alternating samples per mode; diagnostics in separate runs',
    results }, null, 2));
