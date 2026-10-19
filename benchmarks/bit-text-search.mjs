// Build first: npx tsc -b tsconfig.build.json
// Optional comparison: --baseline=/absolute/path/to/interpreter/out/index.js
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const candidate = fileURLToPath(new URL('../packages/interpreter/out/index.js', import.meta.url));
const cases = {
    tiny: { bits: 8, count: 3n, repeats: 10000 },
    dense250k: { bits: 250000, count: 250000n },
    dense1m: { bits: 1000000, count: 1000000n, candidateOnly: true },
    dense4m: { bits: 4000000, count: 4000000n, candidateOnly: true },
    sparse4m: { bits: 4000000, count: 1n },
    four4m: { bits: 4000000, count: 4n },
    characters: {},
    substring: { candidateOnly: true },
    euler167: {},
};

if (option('worker', '')) {
    const name = option('worker', ''), spec = cases[name];
    const moduleUrl = pathToFileURL(option('module', candidate));
    const { Interpreter } = await import(moduleUrl);
    const { bitsModule } = await import(new URL('modules/bits.js', moduleUrl));
    const { findAllValues } = await import(new URL('modules/sequence-search.js', moduleUrl));
    const outputs = [], runtime = new Interpreter(value => outputs.push(value));
    const popcount = bitsModule.popcount({ output() {}, random: Math.random, seedRandom() {}, ownFile() {} });
    const start = performance.now();
    const input = spec.bits ? name === 'tiny' ? 13n
        : name === 'sparse4m' ? 1n << BigInt(spec.bits - 1)
        : name === 'four4m' ? (1n << 3999999n) | (1n << 2000000n) | (1n << 1000000n) | 1n
        : (1n << BigInt(spec.bits)) - 1n
        : name === 'euler167' ? readFileSync(new URL('../demos/euler/167_ulam.ra', import.meta.url), 'utf8')
        : name === 'characters' ? '01'.repeat(500000) : 'a'.repeat(1000000) + 'b';
    const built = performance.now();
    let result;
    const repeats = spec.repeats ?? 1;
    for (let i = 0; i < repeats; i++) {
        result = spec.bits ? popcount.call([input])
            : name === 'euler167' ? runtime.execute(input)
            : findAllValues(input, name === 'characters' ? '1' : 'a'.repeat(10000) + 'b');
    }
    const done = performance.now();
    if (spec.bits) assert.equal(result, spec.count);
    else if (name === 'euler167') assert.equal(outputs.at(-1), '3916160068885');
    else {
        assert.equal(result.shape[0], name === 'characters' ? 500000 : 1);
        for (let i = 0; i < result.shape[0]; i++) assert.equal(result.items[i], BigInt(name === 'characters' ? i * 2 + 1 : 990000));
    }
    console.log(JSON.stringify({ name, bits: spec.bits, repeats, startupMs: start, constructionMs: built - start,
        operationMs: done - built, perCallMs: (done - built) / repeats, executionColdMs: done,
        answer: spec.bits ? String(result) : name === 'euler167' ? outputs.at(-1) : result.shape[0] }));
    runtime.dispose();
} else {
    const trials = Number(option('trials', '3'));
    assert.ok(Number.isInteger(trials) && trials > 0);
    const selected = option('cases', Object.keys(cases).join(',')).split(',');
    assert.ok(selected.every(name => name in cases));
    console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
        candidateCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), trials }));
    for (const [label, modulePath] of [['candidate', candidate], ['baseline', option('baseline', '')]]) {
        if (!modulePath) continue;
        for (const name of selected) {
            if (label === 'baseline' && cases[name].candidateOnly) continue;
            for (let trial = 0; trial < trials; trial++) {
                const start = performance.now();
                const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${name}`, `--module=${modulePath}`], { encoding: 'utf8' });
                const processMs = performance.now() - start;
                assert.equal(run.status, 0, run.stderr || run.error?.message);
                console.log(JSON.stringify({ label, trial, ...JSON.parse(run.stdout.trim()), processMs }));
            }
        }
    }
}
