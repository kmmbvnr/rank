import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const count = 200000, wide = 9007199254740993n;
const cases = {
    routing: [`use sequences
T = 0 till ${count} array
V' = concat ((T * ${wide}) shift 1 with -1) (T * ${wide})
K = array shape ${2 * count} fill 0
(V sum by K) sum`, BigInt(count - 1) ** 2n * wide - 1n],
    stored: [`use sequences
V = array shape ${count} fill 1
K = array shape ${count} fill 0
(V sum by K) sum`, BigInt(count)],
    entries: [`use algo
fun N remember_value Store
 Store add N
 return N
end
Seen = new set
Total = 0
for I in 1 to 10000
 Total += I remember_value Seen
end
Total`, 50005000n],
};
const workSize = 262200;
const workPrefix = `use sequences
Size = ${workSize}
A = array shape Size fill 0
Round = 0`;
cases['work-nested'] = [`${workPrefix}
for Round less 3
 Rows = 3
 Columns = Size // Rows
 for Row in 0 till Rows
  for Col in 0 till Columns
   A (Row * Columns + Col) += 1
  end
 end
 Round += 1
end
A sum`, BigInt(workSize * 3)];
cases['work-branch'] = [`${workPrefix}
for Round less 3
 if Round at least 0
  End = Size - 1
  A (0 to End by 2) += 3
  A (1 to End by 2) += 4
 end
 Round += 1
end
A sum`, BigInt(workSize / 2 * 7 * 3)];
cases['work-passes'] = [`${workPrefix}
for Round less 3
 for I in 0 till Size by 2
  A I += 1
 end
 for I in 1 till Size by 2
  A I += 1
 end
 Round += 1
end
A sum`, BigInt(workSize * 3)];
cases['work-short'] = [`use sequences
A = array shape 128 fill 0
for R in 0 till 5000
 J = 0
 for J less 1
  A 0 += 1
  J += 1
 end
 Scratch = tuple J
end
A sum`, 5000n];
const moveRounds = 32;
for (const [name, width, moveSize] of [['move-2', 2, 32768], ['move-3', 3, 32768], ['move-large', 2, 524288]]) {
    // Independent scalar oracle for the two/three-stage recurrence.
    const values = Array.from({ length: width }, (_, i) => BigInt(i + 1));
    for (let round = 0; round < moveRounds; round++) {
        values[width - 1] = (values[0] * 2n + 1n) % 1000003n;
        values.unshift(values.pop());
    }
    cases[name] = [`use sequences
A = array shape ${moveSize} fill 1
B = array shape ${moveSize} fill 2
${width === 3 ? `C = array shape ${moveSize} fill 3` : ''}
for R in 0 till ${moveRounds}
 for I in 0 till ${moveSize}
  ${width === 3 ? 'C' : 'B'} I = (A I * 2 + 1) mod 1000003
 end
 unpack ${width === 3 ? 'A B C = tuple C A B' : 'A B = tuple B A'}
end
A sum`, values[0] * BigInt(moveSize)];
}
if (process.argv[2] === '--worker') {
    const [, , , checkout, name, engine, diagnostics] = process.argv;
    const { Interpreter, RuntimeDiagnostics, parse } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
    const runtime = new Interpreter(() => {}, { compilation: engine === 'compiled',
        ...(/^(work|move)-/.test(name) ? { scalarEntryCompilation: false } : { integerLoopCompilation: false }) });
    const program = parse(cases[name][0]);
    const stats = diagnostics === 'on' ? new RuntimeDiagnostics() : undefined;
    global.gc();
    const start = performance.now();
    const result = stats ? stats.run(() => runtime.executeProgram(program)) : runtime.executeProgram(program);
    const milliseconds = performance.now() - start;
    assert.equal(result, cases[name][1]);
    global.gc();
    const memory = process.memoryUsage();
    console.log(JSON.stringify({ milliseconds, peakRssKiB: process.resourceUsage().maxRSS,
        retainedHeap: memory.heapUsed, retainedBuffers: memory.arrayBuffers,
        keyedReaders: stats?.keyedNativeReaders, publishedCells: stats?.typedArrayPublishedCells,
        numberLoops: stats?.numberLoops, copyProbes: stats?.numberLoopCopyProbes, costs: stats?.costs, fallbacks: stats?.fallbacks }));
    runtime.dispose();
} else {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice(11);
    if (!baseline) throw new Error('Pass --baseline=/path/to/built/checkout');
    const observations = [];
    const selected = process.argv.find(arg => arg.startsWith('--cases='))?.slice(8).split(',') ?? Object.keys(cases);
    const engines = process.argv.find(arg => arg.startsWith('--engines='))?.slice(10).split(',') ?? ['reference', 'compiled'];
    const samples = Number(process.argv.find(arg => arg.startsWith('--samples='))?.slice(10) ?? 3);
    if (!Number.isSafeInteger(samples) || samples < 1) throw new Error('samples must be a positive integer');
    for (const name of selected) for (const engine of engines) {
        for (let sample = 0; sample <= samples; sample++) {
            for (const [version, checkout] of (sample % 2 ? [['candidate', root], ['baseline', baseline]] : [['baseline', baseline], ['candidate', root]])) {
                const diagnostics = sample === samples ? 'on' : 'off';
                const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--worker', checkout, name, engine, diagnostics],
                    { encoding: 'utf8', timeout: 120000 });
                if (child.status !== 0) throw new Error(child.stderr || String(child.error));
                observations.push({ name, engine, version, diagnostics, sample, ...JSON.parse(child.stdout) });
            }
        }
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, observations }, null, 2));
}
