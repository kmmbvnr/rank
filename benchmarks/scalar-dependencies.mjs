import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { Interpreter } from '../packages/interpreter/out/index.js';

const demo = readFileSync(new URL('./fixtures/euler060-graph.ra', import.meta.url), 'utf8');
const definitions = 'use graph\nuse sequences\n' + demo.slice(demo.indexOf('\nfun '));
const count = 20000;
function prime(n) {
    if (n < 2) return false;
    for (let divisor = 2; divisor * divisor <= n; divisor++) if (n % divisor === 0) return false;
    return true;
}
if (process.argv[2] === '--worker') {
    const fixture = process.argv[3], mode = process.argv[4];
    let calls = 0, loops = 0;
    // Turning off membership alone keeps the stage-one concat kernels and
    // existing loop linking enabled, but prevents compatible from compiling.
    const runtime = new Interpreter(undefined, {
        sequenceMembershipCompilation: mode !== 'baseline',
        integerLoopCompilation: fixture === 'euler' || mode === 'linked',
        onScalarFunctionExecuted: () => calls++, onIntegerLoopExecuted: () => loops++,
    });
    try {
        runtime.execute(definitions);
        if (fixture === 'helper') {
            let expected = 0n, concatCalls = count;
            for (let i = 0; i < count; i++) {
                const q = i * 2 + 3;
                if (prime(Number('3' + q))) {
                    concatCalls++;
                    if (prime(Number(q + '3'))) expected++;
                }
            }
            const source = `Total = 0\nfor I in 0 till ${count}
 if 3 compatible (I * 2 + 3)
  Total += 1
 end
end
Total`;
            const run = () => assert.equal(runtime.execute(source), expected);
            run(); run();
            const samples = [];
            for (let i = 0; i < 7; i++) {
                const start = performance.now(); run(); samples.push(performance.now() - start);
            }
            calls = loops = 0; run();
            assert.equal(calls, concatCalls + (mode === 'baseline' ? 0 : count));
            assert.equal(loops, mode === 'linked' ? 1 : 0);
            console.log(JSON.stringify({ fixture, mode, count, expected: String(expected), samples,
                medianMs: samples.toSorted((a, b) => a - b)[3], calls, loops }));
        } else {
            const phases = {};
            const time = (name, source) => {
                const start = performance.now(), value = runtime.execute(source);
                phases[name] = performance.now() - start;
                return value;
            };
            time('seedBuild', 'Seed = 10000 build');
            assert.equal(runtime.execute('Seed .primes len'), 1227n);
            if (!process.argv.includes('--seed')) {
                assert.equal(time('seedSearch', 'Upper = Seed min_five 50000\nUpper'), 26033n);
                time('fullBuild', 'Full = Upper build');
                assert.equal(time('fullSearch', 'Answer = Full min_five Upper\nAnswer'), 26033n);
            }
            console.log(JSON.stringify({ fixture, mode, phases, calls, loops }));
        }
    } finally { runtime.dispose(); }
} else {
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model }));
    const euler = process.argv.includes('--euler');
    for (let round = 0; round < (euler ? 3 : 1); round++) {
        const modes = euler ? round % 2 ? ['entry', 'baseline'] : ['baseline', 'entry'] : ['baseline', 'entry', 'linked'];
        for (const mode of modes) {
            const child = spawnSync(process.execPath, [import.meta.filename, '--worker', euler ? 'euler' : 'helper', mode,
                ...(process.argv.includes('--seed') ? ['--seed'] : [])], { encoding: 'utf8' });
            assert.equal(child.status, 0, child.stderr || child.stdout);
            console.log(JSON.stringify({ round, ...JSON.parse(child.stdout) }));
        }
    }
}
