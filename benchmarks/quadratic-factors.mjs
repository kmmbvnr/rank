// Build first. Each sample runs in a fresh process. --runtime selects an older
// interpreter for separate measurement of the shared factorization mechanism.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const limit = Number(option('limit') ?? 10000);
assert.ok(Number.isSafeInteger(limit) && limit >= 1 && limit <= 2000000);
const load = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const expected = new Map([[1, 1n], [20, 1371n], [100, 118937n],
    [10000, 55202166687n], [100000, 42661285291615n], [2000000, 269533451410884183n]]);
assert.ok(expected.has(limit), 'Use a checked control limit');
if (option('worker')) {
    const entry = option('runtime') ? pathToFileURL(option('runtime')).href
        : new URL('../packages/interpreter/out/index.js', import.meta.url).href;
    const { Interpreter } = await import(entry);
    const variant = option('worker');
    assert.ok(['manual', 'factors', 'native', 'demo'].includes(variant));
    let source = load(variant === 'demo' ? '../demos/euler/343_fractional.ra' : './fixtures/343-fractional-manual.ra');
    if (variant === 'factors') source = source.replace(/fun N lpf[\s\S]*?\nend/,
        'fun N lpf\n  if N equal 1\n    return 1\n  end\n  return N factors max\nend');
    source = source.replace('option Limit integer = 2000000', `option Limit integer = ${limit}`);
    const compilation = option('compilation') !== 'false';
    const runtime = new Interpreter(() => {}, { compilation });
    const { Factorizer } = await import(new URL('factorization.js', entry).href);
    const factorizer = new Factorizer();
    const lpf = n => { let last = 1n; for (const p of factorizer.factors(n)) last = p; return last; };
    const start = performance.now(), cpu = process.cpuUsage();
    let answer = 0n;
    try {
        if (variant === 'native') {
            for (let k = 1n; k <= BigInt(limit); k++) {
                const a = lpf(k + 1n), b = lpf(k * k - k + 1n);
                answer += (a > b ? a : b) - 1n;
            }
        } else { runtime.execute(source); answer = runtime.variables.get('Answer'); }
        const executeMs = performance.now() - start, usage = process.cpuUsage(cpu);
        assert.equal(answer, expected.get(limit));
        console.log(JSON.stringify({ variant, limit, compilation, executeMs, cpuMs: (usage.user + usage.system) / 1000,
            maxRssKiB: process.resourceUsage().maxRSS, answer: String(answer) }));
    } finally { runtime.dispose(); }
} else {
    const variants = (option('variants') ?? 'manual,factors,demo').split(',');
    const trials = Number(option('trials') ?? 3), samples = new Map(variants.map(v => [v, []]));
    assert.ok(Number.isInteger(trials) && trials > 0);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, runtime: option('runtime') ?? 'current' }));
    for (let trial = 0; trial < trials; trial++) {
        for (const variant of trial % 2 ? [...variants].reverse() : variants) {
            const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${variant}`,
                `--limit=${limit}`, `--compilation=${option('compilation') ?? 'true'}`,
                ...(option('runtime') ? [`--runtime=${option('runtime')}`] : [])],
                { encoding: 'utf8', timeout: 180000 });
            assert.ifError(result.error);
            assert.equal(result.status, 0, result.stderr);
            const sample = { ...JSON.parse(result.stdout), trial };
            samples.get(variant).push(sample); console.log(JSON.stringify(sample));
        }
    }
    for (const [variant, values] of samples) {
        const median = key => values.map(x => x[key]).sort((a, b) => a - b)[Math.floor(values.length / 2)];
        console.log(JSON.stringify({ variant, limit, trials, medianExecuteMs: median('executeMs'), medianCpuMs: median('cpuMs') }));
    }
}
