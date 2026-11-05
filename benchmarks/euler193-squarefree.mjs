// Build: npx tsc -b tsconfig.build.json. Run each sample in a fresh process.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const power = Number(option('power') ?? 50);
const fixture = process.argv.includes('--fixture');
const file = option('source') ?? fileURLToPath(new URL(`../demos/euler/193_squarefree${fixture ? '_test' : ''}.ra`, import.meta.url));
let source = readFileSync(file, 'utf8')
    .replace('Power integer = 50', `Power integer = ${power}`);
if (process.argv.includes('--phases')) source = source.replace('for I in 2 to Top', 'Top print\nfor I in 2 to Top');
const diagnostics = new RuntimeDiagnostics();
const output = [];
const start = performance.now();
const runtime = new Interpreter(line => output.push({ ms: performance.now() - start, line }),
    { compilation: !process.argv.includes('--reference'), testing: fixture, sourceId: file,
        loadModule(specifier, from) {
            const id = resolve(dirname(from ?? file), `${specifier}.ra`);
            return { id, source: readFileSync(id, 'utf8') };
        },
    });
try {
    if (process.argv.includes('--diag')) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const ms = performance.now() - start;
    const rssMiB = process.resourceUsage().maxRSS / 1024;
    const answer = fixture ? undefined : String(runtime.variables.get('Answer'));
    const golden = { 10: '624', 20: '637461', 24: '10199301', 50: '684465067343069' }[power];
    if (!fixture && golden) assert.equal(answer, golden);
    if (fixture) {
        assert.equal(runtime.testResults.length, 1);
        assert(runtime.testResults.every(test => test.passed));
    }
    // Independent oracle: mark every multiple of every square, without Moebius values.
    if (!fixture && process.argv.includes('--oracle')) {
        assert(power >= 0 && power <= 24);
        const limit = 2 ** power, excluded = new Uint8Array(limit);
        for (let d = 2; d * d < limit; d++) {
            for (let n = d * d; n < limit; n += d * d) excluded[n] = 1;
        }
        let count = 0;
        for (let n = 1; n < limit; n++) count += 1 - excluded[n];
        assert.equal(answer, String(count));
    }
    console.log(JSON.stringify({ power, fixture, reference: process.argv.includes('--reference'), ms,
        rssMiB, answer, output, oracle: process.argv.includes('--oracle'),
        ...(!fixture ? { top: String(runtime.variables.get('Top')), primeCount: String(runtime.variables.get('Cnt')) } : {}),
        sourceHash: createHash('sha256').update(source).digest('hex'),
        ...(process.argv.includes('--diag') ? { diagnostics } : {}) }));
} finally { runtime.dispose(); }
