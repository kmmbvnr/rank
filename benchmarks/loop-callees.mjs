import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const cases = {
    array: { setup: `fun A I cellread
 return A I
end
A = array 3 5 7`, body: `Total = 0
for I in 0 till 12000
 Total += A (I mod 3) cellread
end
Total`, expected: 60000n },
    text: { setup: `fun S width
 return S len
end`, body: `Total = 0
for I in 0 till 12000
 Total += "hello" width
end
Total`, expected: 60000n },
    loop: { setup: `fun N triangular
 Total = 0
 for J in 1 to N
  Total += J
 end
 return Total
end`, body: `Sum = 0
for I in 0 till 2000
 Sum += 20 triangular
end
Sum`, expected: 420000n },
};
if (process.argv[2] === '--worker') {
    const fixture = cases[process.argv[3]];
    let executed = 0;
    const runtime = new Interpreter(undefined, { onIntegerLoopExecuted: () => executed++ });
    runtime.execute(fixture.setup);
    const run = () => assert.equal(runtime.execute(fixture.body), fixture.expected);
    run(); run();
    const samples = [];
    for (let i = 0; i < 7; i++) {
        const start = performance.now(); run(); samples.push(performance.now() - start);
    }
    executed = 0;
    const diagnostics = new RuntimeDiagnostics();
    diagnostics.run(run);
    console.log(JSON.stringify({ medianMs: samples.sort((a, b) => a - b)[3], compiledLoops: executed,
        diagnostics: diagnostics }));
    runtime.dispose();
} else {
    const results = {};
    for (const name of Object.keys(cases)) {
        const run = spawnSync(process.execPath, [import.meta.filename, '--worker', name], { encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr);
        results[name] = JSON.parse(run.stdout);
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
        timing: 'Fresh process per case; two warmups, median of seven executions, parsing included; diagnostics in a separate run', results }, null, 2));
}
