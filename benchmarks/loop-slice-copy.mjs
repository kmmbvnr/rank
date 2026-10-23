// npm run build && node benchmarks/loop-slice-copy.mjs
// Fresh-process samples, including a taken snapshot and a reference oracle.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Interpreter, formatValue } from '../packages/interpreter/out/index.js';
import { readArrayItem } from '../packages/interpreter/out/array-storage.js';

const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const size = Number(option('size', '72000'));
const samples = Number(option('samples', '3'));
const snapshot = Number(option('snapshot', '-1'));
assert(Number.isSafeInteger(size) && size > 0);
assert(Number.isSafeInteger(samples) && samples > 0);
assert(Number.isSafeInteger(snapshot));

function program(variant) {
    return `use io
use sequences
N = ${size}
St = array shape (N + 1) fill 0
Sa = St (0 till 0)
Tp = 0
X = 0
for J in 0 till N
 if J equal ${snapshot}
  ${variant === 'control' ? 'X += 1' : `Sa = St (0 till Tp)${variant === 'copy' ? ' copy' : ''}`}
 end
 St Tp = J mod 7
 Tp += 1
 Go = true
 for Go and Tp at least 2
  if St (Tp - 1) greater St (Tp - 2)
   St (Tp - 2) = St (Tp - 1)
   Tp -= 1
  else
   Go = false
  end
 end
end
Tp print`;
}
function run(variant, compilation) {
    const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
    try {
        const start = performance.now();
        runtime.execute(program(variant));
        const ms = performance.now() - start;
        const checksum = name => {
            const array = runtime.variables.get(name), hash = createHash('sha256');
            for (let index = 0; index < array.shape[0]; index++) hash.update(`${formatValue(readArrayItem(array, index))},`);
            return hash.digest('hex');
        };
        return { ms, top: formatValue(runtime.variables.get('Tp')), stack: checksum('St'), snapshot: checksum('Sa') };
    } finally { runtime.dispose(); }
}
if (process.argv.includes('--child')) {
    console.log(JSON.stringify(run(option('variant', 'copy'), option('compilation', 'true') !== 'false')));
} else {
    const child = (variant, compilation = true) => {
        const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child',
            `--variant=${variant}`, `--size=${size}`, `--snapshot=${snapshot}`, `--compilation=${compilation}`], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        return JSON.parse(result.stdout);
    };
    const results = {};
    for (const variant of ['copy', 'view', 'control']) {
        const oracle = child(variant, false);
        const runs = Array.from({ length: samples }, () => child(variant));
        for (const run of runs) {
            const { ms: _, ...observation } = run, { ms: __, ...expected } = oracle;
            assert.deepEqual(observation, expected);
        }
        results[variant] = { medianMs: runs.map(run => run.ms).sort((a, b) => a - b)[Math.floor(samples / 2)], runs, oracle };
    }
    assert.equal(results.copy.oracle.snapshot, results.view.oracle.snapshot);
    assert.equal(results.copy.oracle.stack, results.control.oracle.stack);
    console.log(JSON.stringify({ node: process.version, size, snapshot, samples, results }, null, 2));
}
