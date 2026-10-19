import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const queens = `use algo
use sequences
Columns = 0 till 8 array
Candidates = Columns permutations
Solutions = Candidates filter safe
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
end`;
const workloads = {
    queens,
    'queens-once': queens.replace('Mask = Solutions Columns outer equal\nTotal = (Mask choose 1 0) sum', ''),
    'queens-demo': readFileSync(new URL('../demos/classic/queens_permutations.ra', import.meta.url), 'utf8'),
    'queens-iterative': readFileSync(new URL('../demos/classic/queens_iterative.ra', import.meta.url), 'utf8'),
    'euler60': readFileSync(new URL('../demos/euler/060_primepairs.ra', import.meta.url), 'utf8'),
    sparse: `use sequences
fun X sparse = X mod 10000 equal 0
Candidates = 1 to 250000
Selected = Candidates filter sparse
Prefix = (Selected take 3) sum
Count = Selected len
Total = Selected sum`,
    'stream-budget': `use sequences
Values = (1 to 1000000) filter less 1000001
First = Values sum
Second = Values sum`,
};

if (process.argv[2] === '--worker') {
    const name = process.argv[3];
    assert.ok(Object.hasOwn(workloads, name), name);
    const reuse = !process.argv.includes('--no-reuse');
    const runtime = new Interpreter(() => {}, { sequenceReuse: reuse });
    const stats = new RuntimeDiagnostics();
    try {
        global.gc?.();
        const before = process.memoryUsage().heapUsed;
        const started = performance.now();
        stats.run(() => runtime.execute(workloads[name]));
        const totalMs = performance.now() - started;
        if (name.startsWith('queens') && !name.includes('demo') && !name.includes('iterative')) {
            assert.equal(runtime.variables.get('Count'), 92n);
            if (name === 'queens') assert.equal(runtime.variables.get('Total'), 736n);
        }
        if (name === 'euler60') assert.equal(runtime.variables.get('Answer'), 26033n);
        if (name === 'sparse') {
            assert.equal(runtime.variables.get('Prefix'), 60000n);
            assert.equal(runtime.variables.get('Count'), 25n);
            assert.equal(runtime.variables.get('Total'), 3250000n);
        }
        if (name === 'stream-budget') {
            assert.equal(runtime.variables.get('First'), 500000500000n);
            assert.equal(runtime.variables.get('Second'), 500000500000n);
            if (reuse) assert.equal(stats.sequenceCacheEvictions, 1);
        }
        global.gc?.();
        console.log(JSON.stringify({ name, reuse, totalMs,
            retainedHeapBytes: process.memoryUsage().heapUsed - before,
            peakRssKiB: process.resourceUsage().maxRSS,
            predicateCalls: stats.sequencePredicateCalls,
            replayHits: stats.sequenceReplayHits,
            cachedValues: stats.sequenceCachedValues,
            cachePeakLogicalBytes: stats.sequenceCachePeakBytes,
            cacheEvictions: stats.sequenceCacheEvictions,
            compiledArrayFunctions: stats.compiledArrayFunctions }));
    } finally { runtime.dispose(); }
} else {
    const compare = process.argv.includes('--compare');
    const names = process.argv.slice(2).filter(name => name !== '--compare');
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model }));
    for (let round = 0; round < 3; round++) {
        for (const name of names.length ? names : Object.keys(workloads)) {
            for (const reuse of compare ? round % 2 ? [true, false] : [false, true] : [true]) {
                const result = spawnSync(process.execPath,
                    ['--expose-gc', fileURLToPath(import.meta.url), '--worker', name, ...reuse ? [] : ['--no-reuse']],
                    { encoding: 'utf8' });
                assert.equal(result.status, 0, result.stderr || result.stdout);
                process.stdout.write(result.stdout);
            }
        }
    }
}
