// node benchmarks/collatz-styles.mjs [limit] [samples] [variant]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Interpreter, isRankArray } from '../packages/interpreter/out/index.js';

const limit = Number(process.argv[2] ?? 1000000);
const samples = Number(process.argv[3] ?? 3);
const variant = process.argv[4];
const worker = process.argv[5] === '--worker';
assert(Number.isSafeInteger(limit) && limit >= 3 && limit <= 1000000);
assert(Number.isSafeInteger(samples) && samples > 0);
const sources = {
    memo: `use numbers
memo collatz N rank 0
 if N equal 1
  return 1
 elif N even
  N = N // 2
 else
  N = 3 * N + 1
 end
 return N collatz + 1
end
Lengths = 1 till ${limit} collatz
unpack Longest Position = Lengths max .indexed
Answer = Position + 1`,
    shortcut: `use numbers
memo collatz N rank 0
 if N equal 1
  return 1
 elif N even
  return (N // 2) collatz + 1
 end
 return ((3 * N + 1) // 2) collatz + 2
end
Lengths = 1 till ${limit} collatz
unpack Longest Position = Lengths max .indexed
Answer = Position + 1`,
    array: `use numbers
use sequences
Parents = (0 till ${limit}) copy
Lengths = array shape ${limit} fill 0
Active = Parents greater 1
for Active any
 Values = (Parents Active) copy
 Odd = Values mod 2
 Parents Active = (Values // 2) * (1 - Odd) + (3 * Values + 1) * Odd
 Lengths Active = ((Lengths Active) copy) + 1
 Active = Parents at least ${limit}
end
for (Parents greater 1) any
 NextLengths = (Lengths + Lengths Parents) copy
 Parents = (Parents Parents) copy
 Lengths = NextLengths
end
unpack Steps Answer = Lengths max .indexed
Longest = Steps + 1`,
};
sources.arrayCompact = sources.array
    .replace('Active = Parents greater 1\nfor Active any', `Work = (2 till ${limit}) copy\nfor Work len greater 0`)
    .replaceAll('Parents Active', 'Parents Work')
    .replaceAll('Lengths Active', 'Lengths Work')
    .replace(`Active = Parents at least ${limit}`, `Work = (Work ((Parents Work) at least ${limit})) copy`);
sources.halves = `use numbers
memo collatz N rank 0
 Steps = 0
 for N even
  N = N // 2
  Steps += 1
 end
 if N equal 1
  return Steps + 1
 end
 return ((3 * N + 1) // 2) collatz + Steps + 2
end
Lengths = 1 till ${limit} collatz
unpack Longest Position = Lengths max .indexed
Answer = Position + 1`;
sources.shortcutHalf = sources.shortcut
    .replace(`1 till ${limit}`, `${Math.ceil(limit / 2)} till ${limit}`)
    .replace('Position + 1', `Position + ${Math.ceil(limit / 2)}`);
sources.dense = `use numbers
Lengths = array shape ${limit} fill 0
Lengths 1 = 1
for Start in 2 till ${limit}
 N = Start
 Steps = 0
 for N at least Start
  if N mod 2 equal 0
   N = N // 2
  else
   N = 3 * N + 1
  end
  Steps += 1
 end
 Lengths Start = Steps + Lengths N
end
unpack Longest Answer = Lengths max .indexed`;
assert(variant === undefined || variant.split(',').every(name => name in sources));

if (worker) {
    const oracle = new Map([[1, 1]]);
    let answer = 1, longest = 1;
    for (let start = 2; start < limit; start++) {
        let n = start;
        const path = [];
        while (!oracle.has(n)) { path.push(n); n = n % 2 ? 3 * n + 1 : n / 2; }
        let length = oracle.get(n);
        while (path.length) oracle.set(path.pop(), ++length);
        if (oracle.get(start) > longest) { answer = start; longest = oracle.get(start); }
    }
    const expectedLengths = limit <= 10000 ? Array.from({ length: limit - 1 }, (_, i) => oracle.get(i + 1)) : undefined;
    oracle.clear();
    global.gc();
    const runtime = new Interpreter(() => {});
    try {
        const start = performance.now();
        runtime.execute(sources[variant]);
        const ms = performance.now() - start;
        assert.equal(runtime.variables.get('Answer'), BigInt(answer));
        assert.equal(runtime.variables.get('Longest'), BigInt(longest));
        if (expectedLengths) {
            runtime.execute('use sequences\nChecked = Lengths copy');
            const lengths = runtime.variables.get('Checked');
            assert(isRankArray(lengths));
            const actual = variant.startsWith('array') ? [...lengths.items].slice(1).map(x => x + 1n)
                : variant === 'dense' ? [...lengths.items].slice(1) : [...lengths.items];
            const expected = variant === 'shortcutHalf' ? expectedLengths.slice(Math.ceil(limit / 2) - 1) : expectedLengths;
            assert.deepEqual(actual, expected.map(BigInt));
        }
        global.gc();
        console.log(JSON.stringify({ variant, limit, ms, answer, longest, heapUsed: process.memoryUsage().heapUsed }));
    } finally { runtime.dispose(); }
} else {
    const variants = variant ? variant.split(',') : ['memo', 'shortcut', 'halves', 'shortcutHalf', 'arrayCompact', 'dense'];
    const records = [];
    for (let sample = 0; sample < samples; sample++) for (const name of sample % 2 ? [...variants].reverse() : variants) {
        const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), String(limit), '1', name, '--worker'],
            { encoding: 'utf8', timeout: 180000 });
        assert.equal(child.status, 0, child.error?.message ?? child.stderr);
        const record = { sample, ...JSON.parse(child.stdout) };
        records.push(record);
        console.error(JSON.stringify(record));
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, limit, samples,
        method: 'fresh processes in alternating order; parse and forced reduction included; oracle and GC excluded',
        records, medians: Object.fromEntries(variants.map(name => [name,
            median(records.filter(record => record.variant === name).map(record => record.ms))])) }, null, 2));
}
