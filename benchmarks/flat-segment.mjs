// npm run build && node benchmarks/flat-segment.mjs > .bench/flat-segment.json
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Interpreter } from '../packages/interpreter/out/index.js';
import { FlatRecords } from '../packages/interpreter/out/flat.js';
import { RankSegment } from '../packages/interpreter/out/segment.js';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
    const match = /^--(worker|size|queries|updates|samples|compiled)=(.+)$/.exec(arg);
    if (!match) throw Error(`Unknown argument: ${arg}`);
    return [match[1], match[2]];
}));
const compiled = options.compiled !== 'false';
assert(options.compiled === undefined || ['true', 'false'].includes(options.compiled));
const size = Number(options.size ?? 65536);
const queries = Number(options.queries ?? 10000);
const updates = Number(options.updates ?? 5000);
const samples = Number(options.samples ?? 5);
for (const value of [size, queries, updates, samples]) assert(Number.isSafeInteger(value) && value > 0);
const fields = ['sum', 'prefix', 'suffix', 'best'];
const make = (sum, prefix, suffix, best) => ({ kind: 'record',
    entries: new Map(fields.map((field, i) => [field, [sum, prefix, suffix, best][i]])),
    types: new Map(fields.map(field => [field, 'integer'])) });
const leaf = x => make(x, x > 0n ? x : 0n, x > 0n ? x : 0n, x > 0n ? x : 0n);
const zero = leaf(0n);
const max = (a, b) => a > b ? a : b;
const combineJS = (left, right) => {
    const l = left.entries, r = right.entries;
    return make(l.get('sum') + r.get('sum'), max(l.get('prefix'), l.get('sum') + r.get('prefix')),
        max(r.get('suffix'), r.get('sum') + l.get('suffix')),
        max(max(l.get('best'), r.get('best')), l.get('suffix') + r.get('prefix')));
};
const source = `use numbers
fun combine Left Right
  return record
    .sum = Left .sum + Right .sum
    .prefix = (Left .prefix) max (Left .sum + Right .prefix)
    .suffix = (Right .suffix) max (Right .sum + Left .suffix)
    .best = ((Left .best) max (Right .best)) max (Left .suffix + Right .prefix)
  end
end`;
const initial = i => BigInt((i * 48271 + 17) % 101 - 50);
const queryRange = i => {
    const a = (i * 7919 + 23) % size, b = (i * 3571 + 101) % size;
    return [Math.min(a, b), Math.max(a, b)];
};
const update = i => [(i * 8191 + 7) % size, BigInt((i * 31 + 5) % 101 - 50)];
const digest = value => fields.map(field => value.entries.get(field).toString()).join(',');
const memory = () => {
    // arrayBuffers is part of external; count it once, alongside heapUsed.
    global.gc(); global.gc();
    const { heapUsed, arrayBuffers, rss } = process.memoryUsage();
    return { heapUsed, arrayBuffers, retained: heapUsed + arrayBuffers, rss };
};
const difference = (after, before) => Object.fromEntries(Object.keys(after).map(k => [k, after[k] - before[k]]));
const time = fn => { const start = performance.now(); const result = fn(); return [performance.now() - start, result]; };

if (options.worker) {
    assert(global.gc, 'worker requires --expose-gc');
    const [engine, storage] = options.worker.split('-');
    assert(['js', 'rank'].includes(engine) && ['boxed', 'flat'].includes(storage));
    const runtime = new Interpreter(undefined, { scalarFunctionCompilation: compiled });
    runtime.execute(source);
    const operation = runtime.variables.get('combine');
    const combine = engine === 'rank' ? (a, b) => operation.call([a, b]) : combineJS;
    function input(count) {
        if (storage === 'flat') {
            const values = new FlatRecords(count, zero);
            for (let i = 0; i < count; i++) values.set(i, leaf(initial(i)));
            return values;
        }
        return Array.from({ length: count }, (_, i) => leaf(initial(i)));
    }
    function warmup() {
        const tree = new RankSegment(input(1024), combine, 'combine', engine === 'rank' ? operation : undefined, zero);
        for (let i = 0; i < 2000; i++) {
            tree.query(BigInt(i % 511), BigInt(512 + i % 511));
            tree.set(BigInt(i % 1024), leaf(BigInt(i % 101 - 50)));
        }
    }
    warmup();
    const baseline = memory();
    let values;
    const [inputMs] = time(() => { values = input(size); });
    const inputMemory = memory();
    let tree;
    const [buildMs] = time(() => { tree = new RankSegment(values, combine, 'combine', engine === 'rank' ? operation : undefined, zero); });
    const bothMemory = memory();
    values = undefined;
    const treeMemory = memory();
    // Direct linear oracle checks all four fields before and after updates,
    // and 16 ranges. A matching checksum also checks every query across variants.
    const model = Array.from({ length: size }, (_, i) => initial(i));
    function oracle(left, right) {
        let sum = 0n, prefix = 0n, suffix = 0n, best = 0n;
        for (let i = left; i <= right; i++) {
            sum += model[i]; prefix = max(prefix, sum);
            suffix = max(0n, suffix + model[i]); best = max(best, suffix);
        }
        return make(sum, prefix, suffix, best);
    }
    assert.equal(digest(tree.query(0n, BigInt(size - 1))), digest(oracle(0, size - 1)));
    for (let i = 0; i < 16; i++) {
        const [left, right] = queryRange(i);
        assert.equal(digest(tree.query(BigInt(left), BigInt(right))), digest(oracle(left, right)));
    }
    global.gc();
    const [queryMs, checksum] = time(() => {
        let checksum = 0n;
        for (let i = 0; i < queries; i++) {
            const [left, right] = queryRange(i);
            const result = tree.query(BigInt(left), BigInt(right));
            checksum += result.entries.get('sum') + result.entries.get('best');
        }
        return checksum.toString();
    });
    global.gc();
    const [updateMs] = time(() => {
        for (let i = 0; i < updates; i++) {
            const [index, value] = update(i);
            tree.set(BigInt(index), leaf(value));
        }
    });
    for (let i = 0; i < updates; i++) { const [index, value] = update(i); model[index] = value; }
    const final = digest(tree.query(0n, BigInt(size - 1)));
    assert.equal(final, digest(oracle(0, size - 1)));
    for (let i = 0; i < 16; i++) {
        const [left, right] = queryRange(i);
        assert.equal(digest(tree.query(BigInt(left), BigInt(right))), digest(oracle(left, right)));
    }
    console.log(JSON.stringify({ inputMs, buildMs, queryMs, updateMs, checksum, final,
        inputMemory: difference(inputMemory, baseline), bothMemory: difference(bothMemory, baseline),
        treeMemory: difference(treeMemory, baseline), payloadBytes: tree.storageBytes ?? null }));
    runtime.dispose();
} else {
    const variants = ['js-boxed', 'js-flat', 'rank-boxed', 'rank-flat'];
    const report = { metadata: { date: new Date().toISOString(), node: process.version,
        cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch, size, queries, updates, samples, compiled,
        workload: 'max-subarray state: four integer fields; empty subarrays allowed',
        timing: 'fresh process per sample; warmup; same host tree traversal; JS or Rank combine; forced GC outside timed phases; automatic GC included',
        memory: 'post-GC delta from warmed runtime; heapUsed + arrayBuffers; treeMemory releases input; excludes model and query/update temporaries',
        limitations: 'no peak memory, GC pause attribution or Rank loop/selector overhead measurement',
        rankSource: source, hashes: Object.fromEntries(['benchmarks/flat-segment.mjs', 'packages/interpreter/out/flat.js',
            'packages/interpreter/out/segment.js', 'packages/interpreter/out/flat-combine.js', 'packages/interpreter/out/interpreter.js'].map(path =>
                [path, createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')])) }, results: {} };
    for (let sample = 0; sample < samples; sample++) {
        // Alternate engine and storage order to reduce thermal/order bias.
        const order = sample % 2 ? [...variants].reverse() : variants;
        for (const variant of order) {
            const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url),
                `--worker=${variant}`, `--compiled=${compiled}`, `--size=${size}`, `--queries=${queries}`, `--updates=${updates}`],
            { encoding: 'utf8', timeout: 180000 });
            assert.ifError(child.error);
            assert.equal(child.status, 0, child.stderr);
            const result = JSON.parse(child.stdout);
            (report.results[variant] ??= []).push(result);
            console.error(`Sample ${sample + 1}/${samples} ${variant}: build ${result.buildMs.toFixed(0)} ms, query ${result.queryMs.toFixed(0)} ms, update ${result.updateMs.toFixed(0)} ms`);
        }
    }
    const reference = report.results['js-boxed'][0];
    for (const results of Object.values(report.results)) for (const result of results) {
        assert.equal(result.checksum, reference.checksum);
        assert.equal(result.final, reference.final);
    }
    const median = values => { const sorted = [...values].sort((a, b) => a - b);
        return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2; };
    report.medians = Object.fromEntries(Object.entries(report.results).map(([variant, results]) => [variant,
        Object.fromEntries(['inputMs', 'buildMs', 'queryMs', 'updateMs', 'inputMemory', 'bothMemory', 'treeMemory']
            .map(key => [key, median(results.map(r => key.endsWith('Memory') ? r[key].retained : r[key]))]))]));
    console.log(JSON.stringify(report, null, 2));
}
