// npx tsc -b tsconfig.build.json && node benchmarks/md5-prefix.mjs
// Add --full to verify both AoC passwords for abc (millions of hashes).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Interpreter } from '../packages/interpreter/out/index.js';
import { nodeMd5 } from '../packages/cli/out/node-crypto.js';

const count = 100_000;
// Include the first official matching candidate in this short benchmark.
const start = 3_200_000;
const guards = {
    hex: 'if not (Hash "00000" startswith)\n continue\nend',
    bytes: 'if not (Hash Prefix startswith)\n continue\nend\nif Hash 2 at least 16\n continue\nend',
    indexed: 'if Hash 0 not equal 0\n continue\nend\nif Hash 1 not equal 0\n continue\nend\nif Hash 2 at least 16\n continue\nend',
    positive: 'if Hash Prefix startswith\n if Hash 2 less 16\n  Hits += 1\n end\nend',
};

const selected = process.argv.find(argument => argument.startsWith('--case='))?.slice(7);
if (!selected) {
    // Each case gets a fresh process; run serially to avoid competing for CPU.
    for (const backend of ['portable', 'node']) {
        for (const mode of Object.keys(guards)) {
            const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--case=${backend}-${mode}`], { stdio: 'inherit' });
            assert.equal(child.status, 0);
        }
    }
} else {
    const [backend, mode] = selected.split('-');
    assert.ok(['portable', 'node'].includes(backend) && mode in guards);
    let expected = 0;
    for (let n = start; n < start + count; n += 1) {
        const hash = createHash('md5').update(`abc${n}`).digest();
        if (hash[0] === 0 && hash[1] === 0 && hash[2] < 16) expected += 1;
    }

    const samples = [];
    const runtime = new Interpreter(undefined, { md5: backend === 'node' ? nodeMd5 : undefined });
    try {
        runtime.execute(`use text\nuse crypto\nDoor = "abc"\nPrefix = (array 0 0) bytes
fun search Start Count
  Hits = 0
  N = Start
  Limit = Start + Count
  for N less Limit
    Hash = (Door + (N text)) md5${mode === 'hex' ? ' hex' : ''}
    N += 1
    ${guards[mode]}
    ${mode === 'positive' ? '' : 'Hits += 1'}
  end
  return Hits
end`);
        runtime.execute(`${start} 10000 search`);
        for (let round = 0; round < 3; round += 1) {
            const started = performance.now();
            const result = runtime.execute(`${start} ${count} search`);
            samples.push(Number((performance.now() - started).toFixed(2)));
            assert.equal(result, BigInt(expected));
        }
    } finally {
        runtime.dispose();
    }
    console.log(JSON.stringify({ node: process.version, backend, mode, count, hits: expected, milliseconds: samples }));
}

if (process.argv.includes('--full')) {
    // This counting wrapper is intentionally untrusted and keeps the reference
    // loop. Use aoc-chess.mjs to compare complete compiled/reference searches.
    const source = readFileSync(new URL('../demos/aoc/2016/005_chess.ra', import.meta.url), 'utf8');
    let hashes = 0;
    const runtime = new Interpreter(undefined, {
        md5: value => { hashes += 1; return nodeMd5(value); },
        loadModule: () => ({ id: '/005_chess.ra', source }),
    });
    try {
        runtime.execute('use "005_chess"');
        for (const [part, expectedPassword] of [['part1', '18f47a30'], ['part2', '05ace8e3']]) {
            hashes = 0;
            const started = performance.now();
            const password = runtime.execute(`"abc" ${part}`);
            assert.equal(password, expectedPassword);
            console.log(JSON.stringify({ part, password, hashes, seconds: (performance.now() - started) / 1000 }));
        }
    } finally {
        runtime.dispose();
    }
}
