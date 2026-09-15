// npm run build && node benchmarks/membership.mjs
import assert from 'node:assert/strict';
import { Interpreter, isRankArray } from '../packages/interpreter/out/index.js';

// Both paths query the same finite sequence. Batch timing includes building
// the lookup and materializing the boolean mask; scalar timing counts hits.
const setup = 'Allowed = 2 to 2000 by 2\nNumbers = 1 to 10000\n';
const programs = {
    batch: '(Numbers in Allowed) array',
    scalarLoop: 'Hits = 0\nfor Value in Numbers\n if Value in Allowed\n  Hits += 1\n end\nend\nHits',
};
const milliseconds = { batch: [], scalarLoop: [] };
for (let round = 0; round < 6; round += 1) {
    for (const mode of ['batch', 'scalarLoop']) {
        const runtime = new Interpreter();
        runtime.execute(setup);
        const started = performance.now();
        const result = runtime.execute(programs[mode]);
        const elapsed = performance.now() - started;
        const hits = isRankArray(result) ? result.items.filter(Boolean).length : Number(result);
        assert.equal(hits, 1000);
        if (round > 0) milliseconds[mode].push(Number(elapsed.toFixed(2)));
        runtime.dispose();
    }
}
console.log(JSON.stringify({ node: process.version, queries: 10000, allowed: 1000, hits: 1000, milliseconds }, null, 2));
