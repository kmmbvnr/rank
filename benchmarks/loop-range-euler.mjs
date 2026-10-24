// Profile the unchanged Euler 521 prime-step loop, excluding bulk array work.
// node benchmarks/loop-range-euler.mjs --samples=3 [--runtime=/path/to/checkout]
import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = option('runtime', new URL('../', import.meta.url).pathname.replace(/\/$/, ''));
const n = option('n', '1000000000');
const samples = Number(option('samples', '3'));
if (process.argv.includes('--child')) {
    const { Interpreter, RuntimeDiagnostics, formatValue } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
    const { FastPaths } = await import(pathToFileURL(`${root}/packages/interpreter/out/fast-paths.js`));
    let active = false, loopMs = 0, arrayMs = 0;
    const timed = fn => function (...args) {
        if (!active) return fn(...args);
        const start = performance.now();
        try { return fn(...args); }
        finally { arrayMs += performance.now() - start; }
    };
    // Instrument dependency injection in generated regions, without modifying
    // the runtime or timing nested calls twice. Scalar arithmetic and range
    // construction stay in the residual. Clock overhead also stays there.
    const originalFunction = globalThis.Function;
    globalThis.Function = new Proxy(originalFunction, {
        construct(target, args, newTarget) {
            const factory = Reflect.construct(target, args, newTarget);
            if (!args.includes('copySlice')) return factory;
            return function (...dependencies) {
                for (const name of ['copySlice', 'materializeValue', 'fill']) {
                    const index = args.indexOf(name);
                    if (index >= 0) dependencies[index] = timed(dependencies[index]);
                }
                const index = args.indexOf('arrayValues');
                if (index >= 0 && dependencies[index]) {
                    const values = dependencies[index];
                    dependencies[index] = { ...values,
                        select: timed(values.select), copy: timed(values.copy), binary: timed(values.binary) };
                }
                return factory(...dependencies);
            };
        },
    });
    const compileLoop = FastPaths.prototype.compileLoop;
    FastPaths.prototype.compileLoop = function (node, binding) {
        const compiled = compileLoop.call(this, node, binding);
        if (!compiled || !node.$cstNode?.text.startsWith('for P in primes to C')) return compiled;
        return { run(...args) {
            const start = performance.now(); active = true;
            try { return compiled.run(...args); }
            finally { active = false; loopMs += performance.now() - start; }
        } };
    };
    const runtime = new Interpreter(() => {}, { args: ['--n', n], scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    try {
        const source = readFileSync(new URL('../demos/euler/521_smallestprime.ra', import.meta.url), 'utf8');
        const start = performance.now();
        diagnostics.run(() => runtime.execute(source));
        const ms = performance.now() - start;
        const bound = Number(runtime.variables.get('C'));
        let primes = 0;
        for (let p = 2; p <= bound; p++) {
            let prime = true;
            for (let d = 2; d * d <= p; d++) if (p % d === 0) { prime = false; break; }
            if (prime) primes++;
        }
        assert(primes > 0);
        const answer = formatValue(runtime.variables.get('Answer'));
        if (n === '1000000000') assert.equal(answer, '10688477');
        console.log(JSON.stringify({ ms, loopMs, arrayMs, residualMs: loopMs ? loopMs - arrayMs : null,
            microsecondsPerPrimeOutsideArrays: loopMs ? (loopMs - arrayMs) * 1000 / primes : null,
            primes, answer, compiledLoops: diagnostics.compiledLoops, fallbacks: diagnostics.fallbacks }));
    } finally {
        runtime.dispose(); globalThis.Function = originalFunction; FastPaths.prototype.compileLoop = compileLoop;
    }
} else {
    const run = checkout => {
        const child = spawnSync(process.execPath, [import.meta.filename, '--child', `--runtime=${checkout}`, `--n=${n}`], { encoding: 'utf8' });
        assert.equal(child.status, 0, child.stderr || child.stdout);
        return JSON.parse(child.stdout);
    };
    const baseline = option('baseline');
    const runs = [], baselineRuns = [];
    for (let index = 0; index < samples; index++) {
        // Alternate order to reduce warm-cache and temperature bias.
        if (baseline && index % 2 === 0) baselineRuns.push(run(baseline));
        runs.push(run(root));
        if (baseline && index % 2 !== 0) baselineRuns.push(run(baseline));
    }
    const median = key => runs.some(run => run[key] === null) ? null : runs.map(run => run[key]).sort((a, b) => a - b)[Math.floor(samples / 2)];
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, n, samples, medianMs: median('ms'), medianLoopMs: median('loopMs'),
        medianMicrosecondsPerPrimeOutsideArrays: median('microsecondsPerPrimeOutsideArrays'), runs,
        ...(baseline ? { baseline, baselineRuns, baselineMedianMs: baselineRuns.map(run => run.ms).sort((a, b) => a - b)[Math.floor(samples / 2)] } : {}) }, null, 2));
}
