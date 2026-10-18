// Build first. --baseline=/absolute/path/to/out/index.js adds pre-change gcd/127 runs.
// Each sample is a fresh process; executeMs excludes startup, coldMs includes it.
// --cases=gcd,141 or --trials=1 can select a shorter verification run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const load = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const gcd = inline => `use numbers
S = 0
for A in 1 to 3000
 for B in 1 to 3000
${inline ? `  X = A
  Y = B
  for Y not equal 0
   Z = X mod Y
   X = Y
   Y = Z
  end
  if X equal 1` : '  if A B gcd equal 1'}
   S += 1
  end
 end
end
S`;
const cases = [
    { name: 'gcd-call', group: 'gcd', source: gcd(false), result: 'S', expected: 5472375n },
    { name: 'gcd-inline', group: 'gcd', source: gcd(true), result: 'S', expected: 5472375n },
    ...[['141', 'progressive', 878454337159n], ['155', 'capacitors', 241519n],
        ['170', 'pandigitalproducts', 9857164023n]].flatMap(([number, slug, expected]) => {
        const fixture = { '141': '141-progressive-inline', '155': '155-capacitors-inline', '170': '170-pandigital-inline' }[number];
        return [['inline', `./fixtures/${fixture}.ra`], ['builtin', `../demos/euler/${number}_${slug}.ra`]]
            .map(([variant, path]) => ({ name: `${number}-${variant}`, group: number,
                source: load(path).replace('option Count integer = 18', 'option Count integer = 15'),
                result: 'Answer', expected }));
    }),
    { name: '127-current', group: '127', source: load('../demos/euler/127_abchits.ra'), result: 'Answer', expected: 18407904n },
];
const worker = option('worker');
if (worker) {
    const entry = cases.find(x => x.name === worker);
    assert.ok(entry, `unknown case ${worker}`);
    const runtimePath = option('runtime');
    const { Interpreter, RuntimeDiagnostics } = await import(runtimePath
        ? pathToFileURL(runtimePath).href : '../packages/interpreter/out/index.js');
    const runtime = new Interpreter(() => {}), diagnostic = process.argv.includes('--diagnostic');
    const diagnostics = new RuntimeDiagnostics();
    const start = performance.now();
    try {
        if (diagnostic) diagnostics.run(() => runtime.execute(entry.source));
        else runtime.execute(entry.source);
        const executeMs = performance.now() - start;
        assert.equal(runtime.variables.get(entry.result), entry.expected, entry.name);
        if (diagnostic && entry.group === 'gcd' && !runtimePath) assert.equal(diagnostics.compiledLoops, 1);
        console.log(JSON.stringify({ case: entry.name, executeMs, result: String(entry.expected),
            ...(diagnostic ? { diagnostics } : {}) }));
    } finally { runtime.dispose(); }
} else {
    const selected = option('cases')?.split(','), baseline = option('baseline');
    const trials = Number(option('trials') ?? 3);
    assert.ok(Number.isInteger(trials) && trials > 0);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
        timings: 'fresh processes; executeMs includes parsing; coldMs includes startup and imports; diagnostics separate',
        inputs: { gcd: 3000, '127': 120000, '141': '1000000000000', '155': 15, '170': 0 }, baseline }));
    const samples = new Map();
    for (const entry of cases.filter(x => !selected || selected.includes(x.group))) {
        const variants = [{ label: 'candidate' }];
        if (baseline && ['gcd-call', '127-current'].includes(entry.name)) variants.push({ label: 'baseline', runtime: baseline });
        for (const variant of variants) for (let trial = 0; trial <= trials; trial++) {
            const diagnostic = trial === trials;
            const start = performance.now();
            const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${entry.name}`,
                ...(variant.runtime ? [`--runtime=${variant.runtime}`] : []), ...(diagnostic ? ['--diagnostic'] : [])],
            { encoding: 'utf8', timeout: 180000 });
            assert.equal(child.status, 0, child.stderr || String(child.error));
            const result = JSON.parse(child.stdout);
            if (!diagnostic) {
                const key = `${variant.label}:${entry.name}`;
                if (!samples.has(key)) samples.set(key, []);
                samples.get(key).push({ executeMs: result.executeMs, coldMs: performance.now() - start });
            }
            console.log(JSON.stringify({ variant: variant.label, ...(diagnostic ? { diagnostic: true } : { trial }),
                coldMs: performance.now() - start, ...result }));
        }
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const medians = Object.fromEntries([...samples].map(([key, values]) => [key, {
        executeMs: median(values.map(x => x.executeMs)), coldMs: median(values.map(x => x.coldMs)),
    }]));
    if (selected === undefined || selected.includes('gcd')) {
        assert.ok(medians['candidate:gcd-call'].executeMs <= 2 * medians['candidate:gcd-inline'].executeMs,
            'gcd call must be within 2x inline Euclid');
    }
    console.log(JSON.stringify({ medians }));
}
