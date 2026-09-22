// npx tsc -b tsconfig.build.json && node benchmarks/native-loop.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Interpreter } from '../packages/interpreter/out/index.js';

const count = Number(process.argv[4] ?? 100_000);
const cases = {
    text: {
        body: 'S = "item" + (I text)\nif S "item1" startswith\n continue\nend\nTotal += S len',
        oracle: i => String(i).startsWith('1') ? 0 : `item${i}`.length,
    },
    bytes: {
        body: 'B = ("item" + (I text)) bytes\nif B Prefix startswith\n continue\nend\nTotal += B 4',
        oracle: i => String(i).startsWith('1') ? 0 : String(i).charCodeAt(0),
    },
    bytePrefix: {
        body: 'if Header Prefix startswith\n Total += I\nend',
        oracle: i => i,
    },
    unicode: {
        body: 'S = ((1040 + I % 32) character) lower\nTotal += S codepoint',
        oracle: i => String.fromCodePoint(1040 + i % 32).toLowerCase().codePointAt(0),
    },
    portableMd5: {
        body: 'H = ("abc" + (I text)) md5\nif not (H Empty startswith)\n continue\nend\nif H 2 less 16\n Total += H 0\nend',
        oracle: i => {
            const hash = createHash('md5').update(`abc${i}`).digest();
            return hash[2] < 16 ? hash[0] : 0;
        },
    },
};
const selected = process.argv[2];
if (!selected || selected === '--typed') {
    for (const name of Object.keys(cases)) {
        for (const mode of selected === '--typed' ? ['generic', 'compiled'] : ['reference', 'compiled']) {
            const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name, mode,
                String(selected === '--typed' ? 1_000_000 : count)], { stdio: 'inherit' });
            assert.equal(child.status, 0);
        }
    }
} else {
    assert.ok(Object.hasOwn(cases, selected));
    const mode = process.argv[3];
    assert.ok(['reference', 'generic', 'compiled'].includes(mode));
    const { body, oracle } = cases[selected];
    const expected = n => {
        let sum = 0n;
        for (let i = 0; i < n; i++) sum += BigInt(oracle(i));
        return sum;
    };
    const warmExpected = expected(10_000), fullExpected = expected(count);
    let loops = 0;
    // Generic keeps loop compilation but uses checked, polymorphic builtin calls.
    // Leave md5 unset: arbitrary host callbacks are not proven pure.
    const runtime = new Interpreter(undefined, {
        nativeLoopCompilation: mode !== 'reference', typedNativeCalls: mode !== 'generic',
        onIntegerLoopExecuted: () => loops++,
    });
    try {
        runtime.execute(`use text\nuse crypto
fun work Count
  Total = 0
  Prefix = "item1" bytes
  Header = "item123payload" bytes
  Empty = "" bytes
  for I in 0 until Count
    ${body}
  end
  return Total
end`);
        assert.equal(runtime.execute('10000 work'), warmExpected);
        const milliseconds = [];
        for (let round = 0; round < 5; round++) {
            const start = performance.now();
            const result = runtime.execute(`${count} work`);
            milliseconds.push(Number((performance.now() - start).toFixed(2)));
            assert.equal(result, fullExpected);
        }
        assert.equal(loops, mode !== 'reference' ? 6 : 0);
        const median = [...milliseconds].sort((a, b) => a - b)[2];
        console.log(JSON.stringify({ node: process.version, case: selected, mode, count, median, milliseconds }));
    } finally { runtime.dispose(); }
}
