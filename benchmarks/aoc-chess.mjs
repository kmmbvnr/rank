// npx tsc -b tsconfig.build.json && node benchmarks/aoc-chess.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Interpreter } from '../packages/interpreter/out/index.js';
import { nodeMd5 } from '../packages/cli/out/node-crypto.js';

const [mode, part] = process.argv.slice(2);
const passwords = { part1: '18f47a30', part2: '05ace8e3' };
if (!mode) {
    const samples = new Map();
    for (let round = 0; round < 3; round++) {
        for (const part of Object.keys(passwords)) {
            for (const mode of ['reference', 'compiled']) {
                const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), mode, part], { encoding: 'utf8' });
                assert.equal(child.status, 0, child.stderr || child.stdout);
                const result = JSON.parse(child.stdout);
                console.log(JSON.stringify({ round: round + 1, ...result }));
                const key = `${mode}-${part}`;
                if (!samples.has(key)) samples.set(key, []);
                samples.get(key).push(result.seconds);
            }
        }
    }
    for (const [key, seconds] of samples) {
        console.log(JSON.stringify({ key, seconds, median: [...seconds].sort((a, b) => a - b)[1] }));
    }
} else {
    assert.ok(['reference', 'compiled'].includes(mode));
    assert.ok(Object.hasOwn(passwords, part));
    const source = readFileSync(new URL('../demos/aoc/2016/005_chess.ra', import.meta.url), 'utf8');
    let loops = 0;
    const runtime = new Interpreter(undefined, {
        md5: nodeMd5, nativeLoopCompilation: mode === 'compiled',
        onIntegerLoopExecuted: () => loops++,
        loadModule: () => ({ id: '/005_chess.ra', source }),
    });
    try {
        runtime.execute('use "005_chess"');
        const start = performance.now();
        const password = runtime.execute(`"abc" ${part}`);
        const seconds = (performance.now() - start) / 1000;
        assert.equal(password, passwords[part]);
        assert.equal(loops, mode === 'compiled' ? 1 : 0);
        console.log(JSON.stringify({ node: process.version, mode, part, password, loops, seconds }));
    } finally { runtime.dispose(); }
}
