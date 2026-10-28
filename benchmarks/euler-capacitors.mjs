// Build first. Serial fresh workers; diagnostics/stage probes are separate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const hash = source => createHash('sha256').update(source).digest('hex');
const main = resolve(root, 'demos/euler/155_capacitors.ra');
const runtime = resolve(option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js'));
const program = readFileSync(option('source') ? resolve(option('source')) : main, 'utf8');

// Unencoded rational pairs and both joins; independently canonicalized by GCD.
function oracle(count) {
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const levels = [new Map(), new Map([['1/1', [1, 1]]])];
    const all = new Set(['1/1']);
    for (let n = 2; n <= count; n++) {
        const level = new Map();
        const add = (p, q) => { const g = gcd(p, q); level.set(`${p / g}/${q / g}`, [p / g, q / g]); };
        for (let i = 1; i < n; i++) for (const [a, b] of levels[i].values()) for (const [c, d] of levels[n - i].values()) {
            add(a * d + b * c, b * d);
            add(a * c, a * d + b * c);
        }
        levels[n] = level;
        for (const key of level.keys()) all.add(key);
    }
    return { levels, all };
}

if (option('worker') || option('checks')) {
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtime));
    const fixture = option('worker') === 'fixture';
    const file = fixture ? main.replace('.ra', '_test.ra') : main;
    const stages = [], output = [];
    const makeRuntime = () => new Interpreter(line => { output.push(line); stages.push({ value: line, atMs: performance.now() }); }, {
        testing: true, compilation: option('engine') !== 'reference', sourceId: file,
        loadModule(specifier, from) {
            const id = resolve(dirname(from ?? file), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
            return { id, source: id === main ? program : readFileSync(id, 'utf8') };
        },
    });
    const r = makeRuntime();
    try {
        if (option('checks')) {
            const checks = [];
            for (let count = 1; count <= 10; count++) {
                const expected = oracle(count);
                const check = makeRuntime();
                try {
                    check.execute(program.replace('arg Count integer = 18', `arg Count integer = ${count}`));
                    assert.equal(check.variables.get('Answer'), BigInt(expected.all.size));
                    // Compare complete attainable sets and the exact-count level.
                    const store = Array.from(check.variables.get('Store').items);
                    const key = value => `${value / 8192n}/${value % 8192n}`;
                    assert.deepEqual(new Set(store.map(key)), expected.all);
                    const offsets = check.variables.get('Off').items;
                    const level = store.slice(Number(offsets[count]), Number(offsets[count + 1]));
                    assert.deepEqual(new Set(level.map(key)), new Set(expected.levels[count].keys()));
                    checks.push({ count, answer: expected.all.size, level: level.length });
                } finally { check.dispose(); }
            }
            console.log(JSON.stringify({ engine: option('engine') ?? 'compiled', checks }, null, 2));
        } else {
            let source = fixture ? readFileSync(file, 'utf8') : program;
            if (option('count')) source = source.replace('arg Count integer = 18', `arg Count integer = ${Number(option('count'))}`);
            if (option('stages')) source = source.replace('for M in 2 to Count\n', 'for M in 2 to Count\n  M print\n')
                .replace('  Out =', '  Pairs print\n  Out =').replace('  Par =', '  Used print\n  Par =')
                .replace('  Store = concat', '  Lev len print\n  Store = concat')
                .replace('  Off = concat Off End copy', '  Off = concat Off End copy\n  Store len print');
            const d = new RuntimeDiagnostics(), start = performance.now();
            if (option('diagnostics')) d.run(() => r.execute(source)); else r.execute(source);
            const ms = performance.now() - start, peakRssMiB = process.resourceUsage().maxRSS / 1024;
            if (fixture) { assert.equal(r.testResults.length, 2); assert(r.testResults.every(t => t.passed), JSON.stringify(r.testResults)); }
            else {
                const expected = { 10: 2525n, 12: 15463n, 15: 241519n, 18: 3857447n }[option('count') ?? '18'];
                assert(expected !== undefined); assert.equal(r.variables.get('Answer'), expected);
            }
            console.log(JSON.stringify({ case: option('worker'), engine: option('engine') ?? 'compiled',
                ms, peakRssMiB, answer: String(r.variables.get('Answer')), sourceHash: hash(source), programHash: hash(program),
                tests: r.testResults.map(({ name, passed }) => ({ name, passed })),
                ...(!fixture ? { work: { pairs: String(r.variables.get('Pairs')), used: String(r.variables.get('Used')),
                    stored: r.variables.get('Store').shape[0] } } : {}),
                ...(option('diagnostics') ? { diagnostics: d } : {}),
                ...(option('stages') ? { stages: stages.map(({ value, atMs }) => ({ value, atMs: atMs - start })) } : {}) }));
        }
    } finally { r.dispose(); }
} else {
    const versions = { ...(option('before-source') ? { before: { source: resolve(option('before-source')), runtime: resolve(option('before-runtime') ?? runtime) } } : {}),
        ...(option('ablation') ? {
            runtime: { source: resolve(option('before-source')), runtime },
            source: { source: option('source') ? resolve(option('source')) : main, runtime: resolve(option('before-runtime')) },
        } : {}),
        final: { source: option('source') ? resolve(option('source')) : main, runtime } };
    const jobs = Object.entries(versions).flatMap(([version, paths]) =>
        (option('cases') ?? 'main,fixture').split(',').map(name => ({ version, ...paths, name })));
    const results = [], samples = Number(option('samples') ?? 3);
    assert(Number.isSafeInteger(samples) && samples > 0);
    for (let sample = 0; sample < samples; sample++) for (const job of sample % 2 ? [...jobs].reverse() : jobs) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${job.name}`,
            `--source=${job.source}`, `--runtime=${job.runtime}`,
            ...['engine', 'count', 'diagnostics', 'stages'].flatMap(name => option(name) ? [`--${name}=${option(name)}`] : [])],
        { encoding: 'utf8', timeout: Number(option('deadline') ?? 60000) });
        let result;
        if (child.error?.code === 'ETIMEDOUT') result = { case: job.name, timedOut: true, deadlineMs: Number(option('deadline') ?? 60000) };
        else { assert.ifError(child.error); assert.equal(child.status, 0, child.stderr); result = JSON.parse(child.stdout); }
        results.push({ sample, version: job.version, ...result }); process.stderr.write(JSON.stringify(result) + '\n');
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
        measurements: 'serial fresh processes; parsing and complete execution; validation after timing/RSS; diagnostics separate',
        versions: Object.fromEntries(Object.entries(versions).map(([name, paths]) => [name, { ...paths,
            sourceHash: hash(readFileSync(paths.source)), numericCollectionsHash: hash(readFileSync(resolve(dirname(paths.runtime), 'numeric-collections.js'))) }])),
        results }, null, 2));
}
