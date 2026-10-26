// Build first. Samples run serially in fresh processes, without concurrent tests.
// node benchmarks/euler-arithmetic-expressions.mjs --samples=3
// Add --baseline-runtime=/path/to/old/out/index.js to pair both runtimes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const main = resolve(root, 'demos/euler/093_arithmeticexpr.ra');
const files = { main, fixture: main.replace('.ra', '_test.ra') };

// Independent scalar subset DP, using the same IEEE arithmetic and tolerance.
// Compare every reachable-value set, not only the winning four digits.
function oracle() {
    const values = new Map();
    for (let digit = 0; digit < 10; digit++) values.set(1 << digit, new Set([digit]));
    let candidates = 0, partitions = 0, cells = 0, best = 0, answer = 0;
    for (let mask = 1; mask < 1024; mask++) {
        const digits = Array.from({ length: 10 }, (_, digit) => digit).filter(digit => mask & (1 << digit));
        if (digits.length < 2 || digits.length > 4) continue;
        const out = new Set();
        for (let left = 1; left < mask; left++) {
            candidates++;
            const right = mask ^ left;
            if ((left & mask) !== left || right <= left) continue;
            partitions++;
            for (const a of values.get(left)) for (const b of values.get(right)) {
                out.add(a + b); out.add(a * b); out.add(a - b); out.add(b - a); cells += 4;
                if (b) { out.add(a / b); cells++; }
                if (a) { out.add(b / a); cells++; }
            }
        }
        values.set(mask, out);
        if (digits.length === 4) {
            const seen = new Set([...out].filter(x => x > .5 && Math.abs(x - Math.round(x)) < .000001).map(Math.round));
            let gap = 1;
            while (seen.has(gap)) gap++;
            if (gap - 1 > best) {
                best = gap - 1;
                answer = digits.reduce((n, digit) => n * 10 + digit, 0);
            }
        }
    }
    assert.equal(best, 51); assert.equal(answer, 1258);
    return { values, candidates, partitions, cells };
}

if (option('worker')) {
    const name = option('worker'), file = files[name];
    assert(file);
    const runtimePath = resolve(option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js'));
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtimePath));
    const source = readFileSync(file, 'utf8'), diagnostics = new RuntimeDiagnostics(), output = [];
    const runtime = new Interpreter(line => output.push(line), {
        compilation: option('engine') !== 'reference', testing: true, sourceId: file,
        loadModule(specifier, from) {
            const id = resolve(dirname(from ?? file), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
            return { id, source: readFileSync(id, 'utf8') };
        },
    });
    try {
        const start = performance.now();
        if (option('diagnostics')) diagnostics.run(() => runtime.execute(source));
        else runtime.execute(source);
        const executeMs = performance.now() - start, peakRssMiB = process.resourceUsage().maxRSS / 1024;
        if (name === 'fixture') {
            assert.equal(runtime.testResults.length, 3);
            assert(runtime.testResults.every(test => test.passed), JSON.stringify(runtime.testResults));
            assert(runtime.testResults.every(test => test.output.join('') === '1258'));
        } else {
            assert.deepEqual(output, ['1258']);
            assert.equal(runtime.variables.get('Best'), 51n);
            for (const [mask, expected] of oracle().values) {
                const actual = runtime.variables.get('Vals').entries.get(mask);
                assert.deepEqual(new Set(actual.items), expected, `reachable values for mask ${mask}`);
            }
        }
        console.log(JSON.stringify({ case: name, executeMs, peakRssMiB,
            sourceHash: createHash('sha256').update(source).digest('hex'),
            diagnostics: option('diagnostics') ? diagnostics : undefined,
            tests: runtime.testResults.map(test => ({ name: test.name, passed: test.passed, durationMs: test.durationMs })) }));
    } finally { runtime.dispose(); }
} else {
    const samples = Number(option('samples') ?? 3);
    assert(Number.isSafeInteger(samples) && samples > 0);
    const chosen = option('cases')?.split(',') ?? Object.keys(files);
    assert(chosen.every(name => files[name]));
    const versions = option('baseline-runtime')
        ? [{ version: 'before', runtime: option('baseline-runtime') }, { version: 'after', runtime: option('runtime') }]
        : [{ version: 'current', runtime: option('runtime') }];
    const jobs = chosen.flatMap(name => versions.map(version => ({ name, ...version })));
    const results = [];
    for (let sample = 0; sample < samples; sample++) for (const { name, version, runtime } of sample % 2 ? [...jobs].reverse() : jobs) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${name}`,
            ...(runtime ? [`--runtime=${runtime}`] : []),
            ...['engine', 'diagnostics'].flatMap(name => option(name) ? [`--${name}=${option(name)}`] : [])],
        { encoding: 'utf8', timeout: 60000 });
        assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
        const result = { sample, version, ...JSON.parse(child.stdout) };
        results.push(result); process.stderr.write(JSON.stringify(result) + '\n');
    }
    const { values, ...work } = oracle();
    const runtimeHashes = Object.fromEntries(versions.map(({ version, runtime }) => {
        const directory = dirname(resolve(runtime ?? resolve(root, 'packages/interpreter/out/index.js')));
        return [version, Object.fromEntries(['clause-expression.js', 'sequence.js', 'materialize.js',
            'modules/sequences.js', 'tensor-map.js', 'tensor-kernel.js'].map(file =>
            [file, createHash('sha256').update(readFileSync(resolve(directory, file))).digest('hex')]))];
    }));
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, samples,
        engine: option('engine') ?? 'compiled', runtime: option('runtime') ?? 'current checkout',
        baselineRuntime: option('baseline-runtime'), runtimeHashes, diagnostics: !!option('diagnostics'), work,
        measurements: 'serial fresh processes; complete execution including parsing; process peak RSS before oracle validation',
        results }, null, 2));
}
