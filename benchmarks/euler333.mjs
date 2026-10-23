// Build first: npm run langium:generate && npx tsc -b tsconfig.build.json.
// node benchmarks/euler333.mjs --trials=3 [--timeouts]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { Interpreter, RuntimeDiagnostics, isRankArray } from '../packages/interpreter/out/index.js';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const source = readFileSync(new URL('../demos/euler/333_specialpartitions.ra', import.meta.url), 'utf8');
const helpers = source.slice(0, source.indexOf('option Limit')) + source.slice(source.indexOf('fun Limit solve'));
const solve = helpers.slice(0, helpers.indexOf('rem Counts include'));
// Original traversal from 413eded7, with table construction separated from solve.
const recursive = `fun Limit partitioncounts
  Cnt = array shape Limit fill 0
  Base = 2 log
  Max = (Limit log / Base) floor
  Cnt = 0 1000 0 Limit Cnt Max walk
  return Cnt
end

fun I J Sum Limit Cnt Max walk
  if I greater Max
    if Sum greater 0
      Cnt Sum += 1
    end
    return Cnt
  end
  Cnt = (I + 1) J Sum Limit Cnt Max walk
  V = 2 ** I
  for K in 0 till J
    if Sum + V greater Limit - 1
      break
    end
    I1 = I + 1
    S1 = Sum + V
    Cnt = I1 K S1 Limit Cnt Max walk
    V *= 3
  end
  return Cnt
end`;
const programs = {
    original: solve + recursive,
    counter: 'use algo\n' + solve + recursive.replace('array shape Limit fill 0', 'new counter').replace('Cnt Sum += 1', 'Cnt add Sum'),
    layered: helpers,
};

// Exhaustive enumeration, independent of the layered parity recurrence.
// At Limit <= 1e6 there are <= 40,549,126 leaves, so Uint32 counts cannot overflow.
function reference(limit) {
    const counts = new Uint32Array(limit);
    const max = Math.floor(Math.log2(limit));
    let calls = 0, leaves = 0;
    function walk(i, j, sum) {
        calls++;
        if (i > max) { counts[sum]++; leaves++; return; }
        walk(i + 1, j, sum);
        let value = 2 ** i;
        for (let k = 0; k < j && sum + value < limit; k++, value *= 3) walk(i + 1, k, sum + value);
    }
    walk(0, 1000, 0);
    const composite = new Uint8Array(limit);
    let answer = 0n;
    for (let p = 2; p < limit; p++) {
        if (composite[p]) continue;
        if (counts[p] === 1) answer += BigInt(p);
        for (let multiple = p * p; multiple < limit; multiple += p) composite[multiple] = 1;
    }
    return { counts, answer, calls, leaves };
}

if (option('worker')) {
    const variant = option('worker'), limit = Number(option('limit'));
    assert.ok(variant in programs && Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000000);
    const diagnostic = process.argv.includes('--diagnostic');
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute(programs[variant]); // Parser and definitions are outside the execution timer.
        const start = performance.now();
        const run = () => runtime.execute(`${limit} solve`);
        const answer = diagnostic ? diagnostics.run(run) : run();
        const executeMs = performance.now() - start;
        // Both the independent oracle and full per-cell verification are outside the timer.
        const expected = reference(limit);
        assert.equal(answer, expected.answer);
        runtime.execute(`Check = ${limit} partitioncounts`);
        const check = runtime.execute(variant === 'counter' ? `Check (0 till ${limit})` : 'Check');
        assert.ok(isRankArray(check));
        assert.deepEqual(check.shape, [limit]);
        expected.counts[0] = variant === 'layered' ? 1 : 0; // The new helper includes the empty partition.
        for (let n = 0; n < limit; n++) assert.equal(check.items[n], BigInt(expected.counts[n]), `count at ${n}`);
        console.log(JSON.stringify({ variant, limit, diagnostic, executeMs, answer: String(answer),
            referenceCalls: expected.calls, referenceLeaves: expected.leaves,
            ...(diagnostic ? { cowCopies: diagnostics.cowCopies, cowCopiedCells: diagnostics.cowCopiedCells } : {}) }));
    } finally { runtime.dispose(); }
} else {
    const trials = Number(option('trials') ?? 3);
    assert.ok(Number.isSafeInteger(trials) && trials > 0);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
        timing: 'fresh processes; solve includes table allocation, compilation and prime selection; imports, definitions and oracle excluded; diagnostic runs separate' }));
    const run = (variant, limit, diagnostic = false, timeout = 30000) => {
        const child = spawnSync(process.execPath, [import.meta.filename, `--worker=${variant}`, `--limit=${limit}`,
            ...(diagnostic ? ['--diagnostic'] : [])], { encoding: 'utf8', timeout });
        if (child.error?.code === 'ETIMEDOUT') return { variant, limit, timeoutMs: timeout, status: 'timeout' };
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stderr);
        return JSON.parse(child.stdout);
    };
    for (let trial = 0; trial < trials; trial++) {
        const variants = trial % 2 ? ['layered', 'counter', 'original'] : ['original', 'counter', 'layered'];
        for (const variant of variants) console.log(JSON.stringify({ trial, ...run(variant, 10000) }));
        console.log(JSON.stringify({ trial, ...run('layered', 1000000) }));
    }
    for (const variant of ['original', 'counter', 'layered']) console.log(JSON.stringify(run(variant, 10000, true)));
    console.log(JSON.stringify(run('layered', 1000000, true)));
    if (process.argv.includes('--timeouts')) {
        for (const variant of ['original', 'counter']) console.log(JSON.stringify(run(variant, 1000000)));
    }
}
