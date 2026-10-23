// Build first. Each sample runs alone in a fresh process with a 60-second limit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const candidate = fileURLToPath(new URL('../packages/interpreter/out/index.js', import.meta.url));
const phase = option('phase', 'storage');
const limit = Number(option('limit', '10000000'));
const values = Number(option('values', '2000000'));
const keys = 10000001;
const memory = () => {
    global.gc();
    const m = process.memoryUsage();
    return { heapMiB: m.heapUsed / 2 ** 20, buffersMiB: m.arrayBuffers / 2 ** 20,
        rssMiB: m.rss / 2 ** 20, peakRssMiB: process.resourceUsage().maxRSS / 1024 };
};

if (option('worker', '')) {
    const modulePath = option('module', candidate), kind = option('kind', 'groups');
    const baseUrl = pathToFileURL(modulePath);
    const { Interpreter } = await import(baseUrl);
    if (phase === 'storage') {
        assert(Number.isSafeInteger(values) && values > 0 && values <= 2000000 && values % 2 === 0);
        const { newStructure, counterFrequency, addToCollection } = await import(new URL('collections.js', baseUrl));
        const { indexKey, indexSet, indexRead } = await import(new URL('index-storage.js', baseUrl));

        const before = memory(), start = performance.now();
        const data = kind === 'groups'
            ? new (await import(new URL('integer-groups.js', baseUrl))).RankIntegerGroups(BigInt(keys))
            : newStructure('index');
        const counts = kind === 'index' ? newStructure('counter') : undefined;
        for (let i = 0; i < values; i++) {
            const key = BigInt(Math.floor(i / 2) * 10), value = BigInt(i);
            if (kind === 'groups') data.insert(key, value);
            else {
                indexSet(data, indexKey([key, counterFrequency(counts, key)]), value);
                addToCollection(counts, key);
            }
        }
        const insertMs = performance.now() - start, afterInsert = memory();
        const scanStart = performance.now();
        let checksum = 0n;
        for (let i = 0; i < values; i += 2) {
            const key = BigInt(i / 2 * 10);
            const group = kind === 'groups' ? data.at(key) : undefined;
            if (!group) assert.equal(counterFrequency(counts, key), 2n);
            const iterator = group?.plan.iterate();
            for (let j = 0; j < 2; j++) {
                const value = iterator ? iterator.next().value : indexRead(data, indexKey([key, BigInt(j)]));
                assert.equal(value, BigInt(i + j));
                checksum += value;
            }
            if (iterator) assert.equal(iterator.next().done, true);
        }
        const scanMs = performance.now() - scanStart;
        assert.equal(checksum, BigInt(values) * BigInt(values - 1) / 2n);
        console.log(JSON.stringify({ phase, kind, keys, values, insertMs, scanMs, before, afterInsert,
            peakRssMiB: process.resourceUsage().maxRSS / 1024, typedBytes: data.storageBytes,
            checksum: String(checksum) }));
    } else {
        assert(phase === 'euler' || phase === 'checkpoint');
        const root = resolve(dirname(modulePath), '../../..');
        let source = readFileSync(resolve(root, 'demos/euler/373_circles.ra'), 'utf8')
            .replace('option Limit integer = 10000000', `option Limit integer = ${limit}`);
        if (phase === 'euler') source = source.slice(0, source.indexOf('Spf ='));
        const runtime = new Interpreter(() => {}, { compilation: option('compiled', 'true') !== 'false' });
        try {
            const before = memory(), start = performance.now();
            runtime.execute(source);
            const ms = performance.now() - start, after = memory();
            let checksum = 0n, count = 0, populated = 0;
            const data = runtime.variables.get('Data');
            if (phase === 'euler') {

                const { indexKey, indexRead } = await import(new URL('index-storage.js', baseUrl));
                const { counterFrequency } = await import(new URL('collections.js', baseUrl));
                const counts = runtime.variables.get('Cnt');
                for (let key = 0; key <= limit; key++) {
                    const group = data.kind === 'groups' ? data.at(BigInt(key)) : undefined;
                    const items = group ? [...group.plan.iterate()] : undefined;
                    const length = items ? items.length : Number(counterFrequency(counts, BigInt(key)));
                    if (length) populated++;
                    count += length;
                    for (let j = 0; j < length; j++) {
                        const value = items ? items[j] : indexRead(data, indexKey([BigInt(key), BigInt(j)]));
                        // Weight by key and insertion position to detect changed group contents/order.
                        checksum += (BigInt(key) + 1n) * BigInt(j + 1) * value;
                    }
                }
                if (limit === 10000000) { assert.equal(count, 3183158); assert.equal(populated, 814182); }
            } else {
                const answer = runtime.variables.get('Answer');
                const expected = new Map([[100, 4950n], [1200, 1653605n]]).get(limit);
                assert.notEqual(expected, undefined);
                assert.equal(answer, expected);
                checksum = answer;
            }
            console.log(JSON.stringify({ phase, kind, limit, ms, count, populated,
                before, after, typedBytes: data.storageBytes, checksum: String(checksum) }));
        } finally { runtime.dispose(); }
    }
} else {
    const trials = Number(option('trials', '3'));
    assert(Number.isSafeInteger(trials) && trials > 0);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, phase, trials }));
    let checksum;
    const modules = phase === 'storage' ? [['index', option('baseline', candidate)], ['groups', candidate]]
        : [['index', option('baseline', '')], ['groups', candidate]].filter(([, path]) => path);
    for (const [kind, modulePath] of modules) for (let trial = 0; trial < trials; trial++) {
        const child = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=2048', import.meta.filename,
            '--worker=true', `--phase=${phase}`, `--module=${modulePath}`, `--kind=${kind}`,
            `--limit=${limit}`, `--values=${values}`, `--compiled=${option('compiled', 'true')}`],
        { encoding: 'utf8', timeout: 60000 });
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stderr);
        const result = JSON.parse(child.stdout);
        checksum ??= result.checksum;
        assert.equal(result.checksum, checksum);
        console.log(JSON.stringify({ trial, ...result }));
    }
}
