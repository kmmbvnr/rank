// Build first. Each sample runs in a fresh process; timings include parsing.
// --baseline=/absolute/path/to/interpreter/out/index.js compares another build.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const n = 100000;
const cases = [
    ['gcd', 'I 30 gcd', 449990n],
    ['lcm', 'I 30 lcm', 73499250000n],
    ['isqrt', '(I * I + I) isqrt', 5000050000n],
    ['power', '2 ** (I mod 16)', 409593750n],
    ['cube', '(I mod 1000) ** 3', 24950025000000n],
];
const demoSource = name => {
    if (name.startsWith('272')) {
        let source = readFileSync(new URL('../demos/euler/272_modularcubes.ra', import.meta.url), 'utf8')
            .replace('option Limit integer = 100000000000', 'Limit = 1000000000');
        if (name.endsWith('power')) source = source
            .replace('Pw1 = A1\n    for Rp in 2 to (3 - Mode)\n      Pw1 = Pw1 * A1\n    end', 'Pw1 = A1 ** (3 - Mode)')
            .replace('Pw2 = P1 I2\n      for Rp in 2 to (2 - Mode)\n        Pw2 = Pw2 * P1 I2\n      end', 'Pw2 = (P1 I2) ** (2 - Mode)');
        return source;
    }
    let source = readFileSync(new URL('../demos/euler/424_kakuro.ra', import.meta.url), 'utf8')
        .replace('option Count integer = 200', 'Count = 1');
    if (name.endsWith('power')) source = source.replace(/P2 (Lw|Dv|Pd|D|Lc)\b/g, '(2 ** ($1))')
        .replace('P2 (Fd J)', '(2 ** (Fd J))');
    return source;
};
const demos = [
    ['272-power', undefined, 316174709149021n], ['272-current', undefined, 316174709149021n],
    ['424-power', undefined, 8426039571n], ['424-current', undefined, 8426039571n],
];
const worker = option('worker');
if (worker) {
    const entry = [...cases, ...demos].find(([name]) => name === worker);
    assert.ok(entry);
    const { Interpreter, RuntimeDiagnostics } = await import(option('runtime')
        ? pathToFileURL(option('runtime')).href : '../packages/interpreter/out/index.js');
    const demo = entry[1] === undefined;
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false,
        io: { read: path => readFileSync(new URL(path, new URL('../', import.meta.url))) } });
    const diagnostics = new RuntimeDiagnostics();
    const source = demo ? demoSource(worker) : `use numbers\nS = 0\nfor I in 1 to ${n}\n S += ${entry[1]}\nend\nS`;
    const diagnostic = process.argv.includes('--diagnostic');
    try {
        // Warm parser/JIT with the same workload; timed samples still use fresh runtimes.
        if (!demo) runtime.execute(source);
        const start = performance.now();
        let result = diagnostic ? diagnostics.run(() => runtime.execute(source)) : runtime.execute(source);
        const ms = performance.now() - start;
        if (demo) result = runtime.variables.get('Answer');
        assert.equal(result, entry[2]);
        console.log(JSON.stringify({ name: worker, ms, sourceSha256: createHash('sha256').update(source).digest('hex'), result: String(result), ...(diagnostic ? { diagnostics } : {}) }));
    } finally { runtime.dispose(); }
} else {
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, n, timing: 'fresh processes, one warmup, parsing included; diagnostics separate' }));
    const selected = option('cases')?.split(',');
    const trials = Number(option('trials') ?? 3);
    assert.ok(Number.isInteger(trials) && trials > 0);
    const medians = {};
    for (const [name] of [...cases, ...(selected ? demos : [])].filter(([name]) => !selected || selected.includes(name))) {
        for (const [variant, runtime] of [['candidate', undefined], ...(option('baseline') ? [['baseline', option('baseline')]] : [])]) {
            const samples = [];
            for (let trial = 0; trial <= trials; trial++) {
                const diagnostic = trial === trials;
                const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${name}`,
                    ...(runtime ? [`--runtime=${runtime}`] : []), ...(diagnostic ? ['--diagnostic'] : [])],
                { encoding: 'utf8', timeout: 60000 });
                assert.equal(child.status, 0, child.stderr || String(child.error));
                const result = JSON.parse(child.stdout);
                console.log(JSON.stringify({ variant, trial, diagnostic, ...result }));
                if (!diagnostic) samples.push(result.ms);
            }
            medians[`${variant}:${name}`] = samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
        }
    }
    console.log(JSON.stringify({ medians }));
}
