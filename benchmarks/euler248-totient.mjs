// Run after the TypeScript build. Optional --runtime points at a baseline build.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(option('runtime') ?? 'packages/interpreter/out/index.js')));
const file = resolve('demos/euler/248_eulertotient.ra');
const source = readFileSync(file, 'utf8');
const reference = process.argv.includes('--reference');
const fixture = process.argv.includes('--fixture');
const diagnostics = new RuntimeDiagnostics();
let scalarCalls = 0;
const runtime = new Interpreter(() => {}, { compilation: !reference, testing: fixture, sourceId: file,
    ...(process.argv.includes('--diag') ? { onScalarFunctionExecuted: () => scalarCalls++ } : {}),
    loadModule(specifier, from) { const id = resolve(dirname(from ?? file), `${specifier}.ra`); return { id, source: readFileSync(id, 'utf8') }; },
});
try {
    const start = performance.now();
    if (process.argv.includes('--verify')) {
        // phi(n) >= sqrt(n/2): all solutions for these targets fit this sieve.
        const targets = [2, 4, 6, 8, 12, 24, 120, 720];
        const phi = Uint32Array.from({ length: 2 * 720 ** 2 + 1 }, (_, n) => n);
        for (let p = 2; p < phi.length; p++) if (phi[p] === p)
            for (let n = p; n < phi.length; n += p) phi[n] -= phi[n] / p;
        for (const target of targets) {
            const expected = [];
            for (let n = 1; n < phi.length; n++) if (phi[n] === target) expected.push(BigInt(n));
            const check = new Interpreter(() => {}, { compilation: !reference });
            try {
                check.execute(source.replace('6227020800', String(target)).replace('150000', '1'));
                assert.equal(check.execute('Sols len'), BigInt(expected.length));
                for (let i = 0; i < expected.length; i++) assert.equal(check.execute(`Sols ${i}`), expected[i]);
            } finally { check.dispose(); }
        }
        console.log(JSON.stringify({ reference, verification: 'eight complete inverse-totient sets', ms: performance.now() - start }));
    } else {
        const text = fixture ? readFileSync(file.replace('.ra', '_test.ra'), 'utf8') : source;
        if (process.argv.includes('--diag')) diagnostics.run(() => runtime.execute(text));
        else runtime.execute(text);
        if (fixture) { assert(runtime.testResults.length > 0); assert(runtime.testResults.every(t => t.passed)); }
        else assert.equal(runtime.variables.get('Answer'), 23507044290n);
        console.log(JSON.stringify({ reference, fixture, ms: performance.now() - start,
            rssMiB: process.resourceUsage().maxRSS / 1024, answer: fixture ? undefined : String(runtime.variables.get('Answer')),
            ...(process.argv.includes('--diag') ? { diagnostics, scalarCalls } : {}) }));
    }
} finally { runtime.dispose(); }
