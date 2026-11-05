import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cases = {};
const size = 32768, rounds = Number(process.env.COMPOSABLE_ROUNDS ?? 24);
const warmups = Number(process.env.COMPOSABLE_WARMUPS ?? 0);
const preGc = process.env.COMPOSABLE_PRE_GC ?? '1';
if (!['0', '1'].includes(preGc)) throw new Error('COMPOSABLE_PRE_GC must be 0 or 1');
if (!Number.isSafeInteger(rounds) || rounds < 1 || !Number.isSafeInteger(warmups) || warmups < 0)
    throw new Error('Invalid rounds or warmups');
let a = 1n;
for (let r = 0; r < rounds; r++) a = (2n * a + 1n) % 1000003n;
const sum = a * BigInt(size);
const prefix = `use sequences
fun X nextvalue
 return (X * 2 + 1) mod 1000003
end
fun A nextcell I
 return (A I * 2 + 1) mod 1000003
end
A = array shape ${size} fill 1
B = array shape ${size} fill 2
Saved = A
Total = 0`;
for (const [name, rhs, move, wide] of [
    ['inline', '(A I * 2 + 1) mod 1000003', 'unpack A B = tuple B A', false],
    ['helper', '(A I) nextvalue', 'unpack A B = tuple B A', false],
    ['array-helper', 'A nextcell I', 'unpack A B = tuple B A', false],
    ['mixed', '(A I * 2 + 1) mod 1000003', 'unpack A B = tuple B A', true],
    ['combined', '(A I) nextvalue', 'Temp = A\n A = B\n B = Temp', true],
]) cases[name] = [`${prefix}
for R in 0 till ${rounds}
 for I in 0 till ${size}
  B I = ${rhs}
 end
 ${move}
 ${wide ? 'Total += 9007199254740991' : ''}
end
(A sum) + Total + (Saved sum)`, sum + BigInt(size) + (wide ? BigInt(rounds) * 9007199254740991n : 0n)];
for (const [name, helper] of [
    ['scratch-array', `Scratch = array shape 2 fill X
 Scratch 0 = (X * 2 + 1) mod 1000003
 return Scratch 0`],
    ['scratch-queue', `Queue = new queue
 Queue push ((X * 2 + 1) mod 1000003)
 return Queue pop`],
    ['scratch-index', `Store = new index
 Store 0 = (X * 2 + 1) mod 1000003
 return Store 0`],
    ['scratch-set', `Store = new set
 Store add X
 if X in Store
  return (X * 2 + 1) mod 1000003
 end
 return 0`],
]) cases[name] = [`${prefix}
use algo
fun X scratch
 ${helper}
end
fun X linked
 return X scratch
end
for R in 0 till ${rounds}
 for I in 0 till ${size}
  B I = (A I) linked
 end
 unpack A B = tuple B A
 Total += 9007199254740991
end
(A sum) + Total + (Saved sum)`, sum + BigInt(size) + BigInt(rounds) * 9007199254740991n];
cases.vector = [`${prefix}
for R in 0 till ${rounds}
 B = (A * 2 + 1) mod 1000003
 Temp = A
 A = B
 B = Temp
end
(A sum) + (Saved sum)`, sum + BigInt(size)];
let first = 1n;
for (let r = 0; r < 2 * rounds; r++) first = (2n * first + 1n) % 1000003n;
cases['vector-mixed'] = [`${prefix}
for R in 0 till ${rounds}
 B = (A * 2 + 1) mod 1000003
 B 0 = (B 0) nextvalue
 Total += 9007199254740991
 Temp = A
 A = B
 B = Temp
end
(A sum) + Total + (Saved sum)`, first + a * BigInt(size - 1)
    + BigInt(size) + BigInt(rounds) * 9007199254740991n];
cases.plans = [`use algo
use numbers
use sequences
fun N collect
 Items' = N factors unique
 Store = new set
 A = array shape 2 fill 0
 for P in Items
  Store add P
  A 0 += P
 end
 for P in Items
  if P in Store
   A 1 += P
  end
 end
 return A 0 + A 1
end
Total = 0
for I in 0 till 5000
 Total += 360 collect
end
Total`, 100000n];

if (process.argv[2] === '--worker') {
    const [, , , checkout, name, engine, diagnostics] = process.argv;
    const { Interpreter, RuntimeDiagnostics, parse } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
    const runtime = new Interpreter(() => {}, { compilation: engine === 'compiled', scalarEntryCompilation: name === 'plans' });
    const program = parse(cases[name][0]);
    const stats = diagnostics === 'on' ? new RuntimeDiagnostics() : undefined;
    for (let i = 0; i < warmups; i++) assert.equal(runtime.executeProgram(program), cases[name][1]);
    if (preGc === '1') global.gc();
    const start = performance.now();
    const result = stats ? stats.run(() => runtime.executeProgram(program)) : runtime.executeProgram(program);
    const milliseconds = performance.now() - start;
    assert.equal(result, cases[name][1]);
    global.gc();
    const memory = process.memoryUsage();
    console.log(JSON.stringify({ milliseconds, peakRssKiB: process.resourceUsage().maxRSS,
        retainedHeap: memory.heapUsed, retainedBuffers: memory.arrayBuffers,
        numberLoops: stats?.numberLoops, mixedLoops: stats?.mixedIntegerLoops,
        costs: stats?.costs, fallbacks: stats?.fallbacks }));
    runtime.dispose();
} else {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice(11);
    if (!baseline) throw new Error('Pass --baseline=/path/to/built/checkout');
    const selected = process.argv.find(arg => arg.startsWith('--cases='))?.slice(8).split(',') ?? Object.keys(cases);
    const engines = process.argv.find(arg => arg.startsWith('--engines='))?.slice(10).split(',') ?? ['compiled'];
    const samples = Number(process.argv.find(arg => arg.startsWith('--samples='))?.slice(10) ?? 3);
    if (!Number.isSafeInteger(samples) || samples < 1) throw new Error('samples must be a positive integer');
    const observations = [];
    for (const name of selected) for (const engine of engines) for (let sample = 0; sample <= samples; sample++) {
        for (const [version, checkout] of (sample % 2 ? [['candidate', root], ['baseline', baseline]] : [['baseline', baseline], ['candidate', root]])) {
            const diagnostics = sample === samples ? 'on' : 'off';
            const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--worker', checkout, name, engine, diagnostics],
                { encoding: 'utf8', timeout: 120000 });
            if (child.status !== 0) throw new Error(child.stderr || String(child.error));
            observations.push({ name, engine, version, diagnostics, sample, ...JSON.parse(child.stdout) });
        }
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, size, rounds, warmups, preGc: preGc === '1', observations }, null, 2));
}
