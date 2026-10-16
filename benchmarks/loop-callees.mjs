import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const demo = name => {
    const source = readFileSync(new URL(`../demos/euler/${name}.ra`, import.meta.url), 'utf8')
        .replace('use cli', '').replace(/option (\w+) integer =/g, '$1 =').replace('Answer print', '');
    const definitions = source.indexOf('\nfun ');
    return { setup: definitions < 0 ? '' : source.slice(definitions),
        body: (definitions < 0 ? source : source.slice(0, definitions)) + '\nAnswer', regression: true };
};
const cases = {
    collatzDemo: { ...demo('014_collatz'), expected: 837799n },
    palindromeDemo: { ...demo('004_palproduct'), expected: 906609n },
    containers: { setup: `use algo
fun Cache N chainlength
 Path = new stack
 for N not in Cache
  Path push N
  if N mod 2 equal 0
   N = N // 2
  else
   N = 3 * N + 1
  end
 end
 Length = Cache N
 for Path len greater 0
  N = Path pop
  Length += 1
  Cache N = Length
 end
 return Length
end`, body: `Cache = new index
Cache 1 = 1
Best = 0
Answer = 0
for I in 1 till 10000
 Length = Cache I chainlength
 if Length greater Best
  Best = Length
  Answer = I
 end
end
Answer`, expected: 6171n },
    scratch: { setup: `fun N scratch
 A = array shape N fill 1
 Total = 0
 for J in 0 till N
  A J = J
  Total += A J
 end
 return Total
end`, body: `Sum = 0
for I in 0 till 2000
 Sum += 20 scratch
end
Sum`, expected: 380000n },
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
    const runtime = new Interpreter(undefined, { scalarCallCompilation: process.argv[4] !== '--reference', onIntegerLoopExecuted: () => executed++ });
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
    if (process.argv[4] !== '--reference' && !fixture.regression) assert.equal(executed, 1, 'the outer region must compile');
    console.log(JSON.stringify({ medianMs: samples.sort((a, b) => a - b)[3], compiledLoops: executed,
        diagnostics: diagnostics }));
    runtime.dispose();
} else {
    const results = {};
    for (const name of Object.keys(cases)) {
        const run = spawnSync(process.execPath, [import.meta.filename, '--worker', name, ...(process.argv.includes('--reference') ? ['--reference'] : [])], { encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr);
        results[name] = JSON.parse(run.stdout);
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
        timing: 'Fresh process per case; two warmups, median of seven executions, parsing included; diagnostics in a separate run', results }, null, 2));
}
