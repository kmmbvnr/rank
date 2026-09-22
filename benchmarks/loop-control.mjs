// npx tsc -b tsconfig.build.json && node benchmarks/loop-control.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Interpreter } from '../packages/interpreter/out/index.js';
import { nodeMd5 } from '../packages/cli/out/node-crypto.js';

const count = 100_000;
const cases = {
    numeric: {
        body: 'if I % 2 equal 0\n continue\nend\nTotal += I',
        expected: n => BigInt(n / 2) ** 2n,
    },
    text: {
        body: 'S = I text\nif S "1" startswith\n continue\nend\nTotal += S len',
        expected: n => {
            let sum = 0;
            for (let i = 0; i < n; i++) if (!String(i).startsWith('1')) sum += String(i).length;
            return BigInt(sum);
        },
    },
    hashContinue: {
        body: 'H = ("abc" + ((I + 3200000) text)) md5\nif not (H Prefix startswith)\n continue\nend\nif H 2 at least 16\n continue\nend\nTotal += 1',
        expected: n => n === count ? 1n : 0n,
    },
    hashIf: {
        body: 'H = ("abc" + ((I + 3200000) text)) md5\nif H Prefix startswith\n if H 2 less 16\n  Total += 1\n end\nend',
        expected: n => n === count ? 1n : 0n,
    },
    nestedBreak: {
        body: 'for J in 0 to 10\n S = I text\n if S "" startswith\n  break\n end\n Total += 1000\nend\nTotal += 1',
        expected: n => BigInt(n),
    },
};
const selected = process.argv[2];
if (!selected) {
    for (const name of Object.keys(cases)) {
        for (const mode of ['reference', 'direct']) {
            const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name, mode], { stdio: 'inherit' });
            assert.equal(child.status, 0);
        }
    }
} else {
    assert.ok(selected in cases);
    const mode = process.argv[3];
    assert.ok(['reference', 'direct'].includes(mode));
    const { body, expected } = cases[selected];
    // Force the general loop path: fully compiled integer loops already use
    // native jumps. Hash/text operations naturally exercise this path too.
    const runtime = new Interpreter(undefined, {
        md5: nodeMd5, directLoopControl: mode === 'direct', integerLoopCompilation: false,
    });
    try {
        runtime.execute(`use text\nuse crypto
fun work Count
  Total = 0
  Prefix = (array 0 0) bytes
  for I in 0 until Count
    ${body}
  end
  return Total
end`);
        assert.equal(runtime.execute('10000 work'), expected(10000));
        const milliseconds = [];
        for (let round = 0; round < 5; round++) {
            const start = performance.now();
            const result = runtime.execute(`${count} work`);
            milliseconds.push(Number((performance.now() - start).toFixed(2)));
            assert.equal(result, expected(count));
        }
        const median = [...milliseconds].sort((a, b) => a - b)[2];
        console.log(JSON.stringify({ node: process.version, case: selected, mode, count, median, milliseconds }));
    } finally { runtime.dispose(); }
}
