import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { Interpreter } from '../packages/interpreter/out/index.js';

const sources = {
    before: new URL('./fixtures/euler060-before-batching.ra', import.meta.url),
    batched: new URL('./fixtures/euler060-graph.ra', import.meta.url),
};
if (process.argv[2] === '--worker') {
    const mode = process.argv[3];
    const source = readFileSync(sources[mode], 'utf8');
    const runtime = new Interpreter(() => {});
    try {
        const start = performance.now();
        runtime.execute(source);
        const totalMs = performance.now() - start;
        assert.equal(runtime.variables.get('Upper'), 26033n);
        assert.equal(runtime.variables.get('Answer'), 26033n);
        const storedEdges = ['Seed', 'Full'].map(name => {
            const graph = runtime.variables.get(name).entries.get('graph');
            return [...graph.adjacency.values()].reduce((count, edges) => count + edges.length, 0);
        });
        console.log(JSON.stringify({ mode, totalMs, storedEdges, peakRssKiB: process.resourceUsage().maxRSS, answer: '26033' }));
    } finally { runtime.dispose(); }
} else {
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model }));
    for (let round = 0; round < 5; round++) {
        for (const mode of round % 2 ? ['batched', 'before'] : ['before', 'batched']) {
            const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', mode], { encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr || result.stdout);
            process.stdout.write(result.stdout);
        }
    }
}
