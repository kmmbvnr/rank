// Build both checkouts before running. Measures a component, not FFT.
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { baseline: { type: 'string' }, checkout: { type: 'string' } } });
assert(values.baseline, 'pass --baseline pointing to a built checkout');
const roots = { baseline: resolve(values.baseline),
 candidate: resolve(values.checkout ?? fileURLToPath(new URL('..', import.meta.url))) };
const size = 8192, cells = Float64Array.from({ length: size }, (_, i) => Math.sin(i * .37));
const run = {};
for (const [name, root] of Object.entries(roots)) {
 const { typedArray } = await import(pathToFileURL(root + '/packages/interpreter/out/array-storage.js'));
 run[name] = () => typedArray(cells, [size], undefined, 'real').items;
 assert.deepEqual([...run[name]()], [...cells]);
}
for (const name of Object.keys(run)) {
 const start = performance.now(); while (performance.now() - start < 1000) run[name]();
}
const rows = [];
for (let pair = 0; pair < 7; pair++) for (const name of pair % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
 const cpu = process.cpuUsage(), start = performance.now(); let count = 0, out;
 do { out = run[name](); count++; } while (performance.now() - start < 300);
 const elapsed = performance.now() - start, used = process.cpuUsage(cpu);
 assert.deepEqual([...out], [...cells]);
 rows.push({ pair, name, count, ms: elapsed / count, cpuMs: (used.user + used.system) / 1000 / count });
}
const median = xs => [...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
console.log(JSON.stringify({ roots, size, note: 'Within-process alternating component check; includes ownership publication and full public items conversion, reuses readonly input. Not full FFT timings.', rows,
 summary: Object.keys(roots).map(name=>({name, ms:median(rows.filter(r=>r.name===name).map(r=>r.ms)), cpuMs:median(rows.filter(r=>r.name===name).map(r=>r.cpuMs))})) }));
