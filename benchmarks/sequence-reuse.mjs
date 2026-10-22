import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

// Compare explicit retention with recomputed plans. Input stages stay deferred
// in both variants, so the measured boundary is the selected result's binding.
const workloads = {
    queens: marker => `use algo
use sequences
Columns = 0 till 8 array
Candidates' = Columns permutations
Solutions${marker} = Candidates filter safe
Count = Solutions len
Mask = Solutions Columns outer equal
Total = (Mask choose 1 0) sum
fun Q safe rank 1
 Up = Q + Columns unique len
 if Up not equal 8
  return false
 end
 Down = Q - Columns unique len
 return Down equal 8
end`,
    sparse: marker => `use sequences
fun X sparse = X mod 10000 equal 0
Candidates' = 1 to 250000
Selected${marker} = Candidates filter sparse
Prefix = (Selected take 3) sum
Count = Selected len
Total = Selected sum`,
    prefix: marker => `use sequences
Values${marker} = (1 to 10000) filter less 10001
Total = (Values take 3) sum`,
    scan: marker => `use sequences
Values${marker} = 1 to 1000 scan +
First = Values sum
Total = Values sum`,
};

if (process.argv[2] === '--worker') {
    const name = process.argv[3];
    assert.ok(Object.hasOwn(workloads, name), name);
    const modeIndex = process.argv.indexOf('--mode');
    const mode = modeIndex < 0 ? 'stored' : process.argv[modeIndex + 1];
    assert.ok(['stored', 'deferred'].includes(mode), mode);
    const compilation = !process.argv.includes('--reference');
    const source = workloads[name](mode === 'deferred' ? "'" : '');
    const runtime = new Interpreter(() => {}, { compilation });
    const stats = new RuntimeDiagnostics();
    try {
        global.gc?.();
        const before = process.memoryUsage().heapUsed;
        const started = performance.now();
        stats.run(() => runtime.execute(source));
        const totalMs = performance.now() - started;
        if (name === 'queens') {
            assert.equal(runtime.variables.get('Count'), 92n);
            assert.equal(runtime.variables.get('Total'), 736n);
        } else if (name === 'sparse') {
            assert.equal(runtime.variables.get('Prefix'), 60000n);
            assert.equal(runtime.variables.get('Count'), 25n);
            assert.equal(runtime.variables.get('Total'), 3250000n);
        } else if (name === 'prefix') {
            assert.equal(runtime.variables.get('Total'), 6n);
        } else if (name === 'scan') {
            assert.equal(runtime.variables.get('First'), 167167000n);
            assert.equal(runtime.variables.get('Total'), 167167000n);
        }
        global.gc?.();
        console.log(JSON.stringify({ name, mode, compilation,
            sha256: createHash('sha256').update(source).digest('hex'), totalMs,
            retainedHeapBytes: process.memoryUsage().heapUsed - before,
            peakRssKiB: process.resourceUsage().maxRSS,
            predicateCalls: stats.sequencePredicateCalls,
            compiledArrayFunctions: stats.compiledArrayFunctions }));
    } finally { runtime.dispose(); }
} else {
    const compare = process.argv.includes('--compare');
    const reference = process.argv.includes('--reference');
    const names = process.argv.slice(2).filter(name => !['--compare', '--reference'].includes(name));
    for (const name of names) assert.ok(Object.hasOwn(workloads, name), name);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model }));
    for (let round = 0; round < 3; round++) {
        for (const name of names.length ? names : ['sparse']) {
            const modes = compare ? round % 2 ? ['stored', 'deferred'] : ['deferred', 'stored'] : ['stored'];
            for (const mode of modes) {
                const result = spawnSync(process.execPath,
                    ['--expose-gc', fileURLToPath(import.meta.url), '--worker', name, '--mode', mode,
                        ...reference ? ['--reference'] : []],
                    { encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024 });
                assert.ifError(result.error);
                assert.equal(result.status, 0, result.stderr || result.stdout);
                process.stdout.write(result.stdout);
            }
        }
    }
}
