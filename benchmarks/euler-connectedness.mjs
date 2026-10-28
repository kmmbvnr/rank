// Build first. Fresh serial workers; phase probes/diagnostics are separate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const file = resolve(root, 'demos/euler/186_connectedness.ra');
const source = readFileSync(file, 'utf8');
const ringSource = readFileSync(resolve(root, 'benchmarks/fixtures/euler186-ring.ra'), 'utf8');
const cursorSource = readFileSync(resolve(root, 'benchmarks/fixtures/euler186-ring-cursors.ra'), 'utf8');
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const hash = value => createHash('sha256').update(value).digest('hex');
const runtimePath = resolve(option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js'));
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtimePath));

function generate(users, calls) {
    const t = new Int32Array(2 * calls);
    for (let k = 1; k <= 55; k++) t[k - 1] = (100003 - 200003 * k + 300007 * k * k * k) % users;
    for (let k = 55; k < t.length; k++) t[k] = (t[k - 24] + t[k - 55]) % users;
    return t;
}

// Same algorithm, bounds, complete generator and early exit as the Rank demo.
function native(users = 1000000, calls = 3000000, pm = 524287, percent = 99, streaming = false) {
    const start = performance.now(), t = streaming ? generate(users, 28).subarray(0, 55) : generate(users, calls);
    const generated = performance.now();
    let position = 0;
    const next = () => {
        const k = position++;
        if (k >= 55) t[k % 55] = (t[(k - 24) % 55] + t[k % 55]) % users;
        return t[k % 55];
    };
    const up = Int32Array.from({ length: users }, (_, i) => i);
    const size = new Int32Array(users).fill(1);
    const want = Math.floor(users * percent / 100);
    let made = 0, answer = 0, processed = 0;
    const find = a => {
        while (up[a] !== a) { up[a] = up[up[a]]; a = up[a]; }
        return a;
    };
    for (let n = 0; n < calls; n++) {
        processed++;
        let a = streaming ? next() : t[2 * n], b = streaming ? next() : t[2 * n + 1];
        if (a === b) continue;
        made++;
        a = find(a); b = find(b);
        if (a !== b) {
            if (size[a] < size[b]) { up[a] = b; size[b] += size[a]; }
            else { up[b] = a; size[a] += size[b]; }
        }
        if (size[find(pm)] >= want) { answer = made; break; }
    }
    return { answer, processed, generationMs: generated - start, networkMs: performance.now() - generated };
}

// Independent component oracle: adjacency lists and BFS, no union-find.
function oracle(users, calls, pm, percent) {
    const t = generate(users, calls), edges = Array.from({ length: users }, () => []);
    let made = 0;
    for (let n = 0; n < calls; n++) {
        const a = t[2 * n], b = t[2 * n + 1];
        if (a === b) continue;
        made++; edges[a].push(b); edges[b].push(a);
        const seen = new Set([pm]), queue = [pm];
        for (let i = 0; i < queue.length; i++) for (const v of edges[queue[i]]) {
            if (!seen.has(v)) { seen.add(v); queue.push(v); }
        }
        if (seen.size >= Math.floor(users * percent / 100)) return made;
    }
    return 0;
}

function runtime(engine, path = file) {
    return new Interpreter(() => {}, { testing: true, compilation: engine !== 'reference', sourceId: path,
        loadModule(specifier, from) {
            const id = resolve(dirname(from ?? path), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
            return { id, source: readFileSync(id, 'utf8') };
        },
    });
}

if (option('worker')) {
    const name = option('worker'), engine = option('engine') ?? 'compiled';
    const d = new RuntimeDiagnostics(), start = performance.now();
    let details = {};
    if (name === 'native' || name === 'native-ring') {
        details = native(1000000, 3000000, 524287, 99, name === 'native-ring'); assert.equal(details.answer, 2325629);
    } else {
        const path = name === 'fixture' ? file.replace('.ra', '_test.ra') : file;
        const r = runtime(engine, path);
        try {
            const run = () => {
                if (name === 'phases') {
                    const split = source.indexOf('Up = 0 till Users array');
                    const first = performance.now(); r.execute(source.slice(0, split));
                    const second = performance.now(); r.execute(source.slice(split));
                    details = { generationMs: second - first, networkMs: performance.now() - second };
                } else r.execute(name === 'ring' ? ringSource : name === 'ring-cursors' ? cursorSource : readFileSync(path, 'utf8'));
            };
            if (option('diagnostics')) d.run(run); else run();
            if (name === 'fixture') {
                assert.equal(r.testResults.length, 2);
                assert(r.testResults.every(t => t.passed), JSON.stringify(r.testResults));
            } else assert.equal(r.variables.get('Answer'), 2325629n);
            details.tests = r.testResults.map(({ name, passed }) => ({ name, passed }));
        } finally { r.dispose(); }
    }
    console.log(JSON.stringify({ case: name, engine, ms: performance.now() - start,
        peakRssMiB: process.resourceUsage().maxRSS / 1024, ...details,
        ...(option('diagnostics') ? { diagnostics: d } : {}) }));
} else if (option('checks')) {
    const checks = [];
    for (const users of [80, 100, 127]) for (const percent of [1, 50, 99]) {
        const calls = 1000, pm = users - 1, expected = oracle(users, calls, pm, percent);
        for (const streaming of [false, true]) assert.equal(native(users, calls, pm, percent, streaming).answer, expected);
        for (const [variant, program] of [['original', source], ['ring', ringSource], ['ring-cursors', cursorSource]]) for (const engine of ['compiled', 'reference']) {
            const r = runtime(engine);
            try {
                r.execute(program.replace('Users = 1000000', `Users = ${users}`)
                    .replace('Pm = 524287', `Pm = ${pm}`)
                    .replace('arg Calls integer = 3000000', `arg Calls integer = ${calls}`)
                    .replace('arg Percent integer = 99', `arg Percent integer = ${percent}`));
                assert.equal(r.variables.get('Answer'), BigInt(expected));
                checks.push({ variant, users, percent, engine, answer: expected });
            } finally { r.dispose(); }
        }
    }
    for (const program of [ringSource, cursorSource]) for (const engine of ['compiled', 'reference']) {
        const r = runtime(engine);
        try {
            r.execute(program.replace('arg Calls integer = 3000000', 'arg Calls integer = 1000')
                .replace('arg Percent integer = 99', 'arg Percent integer = 101')
                .replace('Made = 0', 'Trace = array shape 2000 fill 0\nMade = 0')
                .replace('  if A not equal B', '  Trace (2 * N) = A\n  Trace (2 * N + 1) = B\n  if A not equal B'));
            assert.deepEqual(Array.from(r.variables.get('Trace').items), Array.from(generate(1000000, 1000), BigInt));
            checks.push({ engine, generatorTerms: 2000 });
        } finally { r.dispose(); }
    }
    console.log(JSON.stringify({ checks }, null, 2));
} else {
    const results = [], samples = Number(option('samples') ?? 3);
    const versions = { ...(option('before-runtime') ? { before: resolve(option('before-runtime')) } : {}), final: runtimePath };
    const jobs = (option('cases') ?? 'main,fixture,native').split(',').flatMap(name =>
        Object.entries(versions).filter(([version]) => !name.startsWith('native') || version === 'final')
            .map(([version, runtime]) => ({ name, version, runtime })));
    for (let sample = 0; sample < samples; sample++) for (const { name, version, runtime } of sample % 2 ? [...jobs].reverse() : jobs) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${name}`,
            `--runtime=${runtime}`,
            ...['engine', 'diagnostics'].flatMap(key => option(key) ? [`--${key}=${option(key)}`] : [])],
        { encoding: 'utf8', timeout: Number(option('deadline') ?? 60000) });
        let result;
        if (child.error?.code === 'ETIMEDOUT') result = { case: name, timedOut: true };
        else { assert.ifError(child.error); assert.equal(child.status, 0, child.stderr); result = JSON.parse(child.stdout); }
        results.push({ sample, version, ...result });
        process.stderr.write(JSON.stringify(result) + '\n');
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
        sourceHash: hash(source), ringSourceHash: hash(ringSource), cursorSourceHash: hash(cursorSource),
        versions: Object.fromEntries(Object.entries(versions).map(([name, path]) => [name,
            { path, arrayReadHash: hash(readFileSync(resolve(dirname(path), 'array-read.js'))) }])),
        measurements: 'serial fresh processes; worker time includes interpreter construction, parsing and validation',
        results }, null, 2));
}
