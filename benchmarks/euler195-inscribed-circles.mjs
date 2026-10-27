// Build: npx tsc -b tsconfig.build.json. Use one fresh process per sample.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const { Interpreter, RuntimeDiagnostics } = await import(option('runtime')
    ? pathToFileURL(option('runtime')).href : '../packages/interpreter/out/index.js');
const limit = Number(option('limit') ?? 1053779);
const fixture = process.argv.includes('--fixture');
const file = option('source') ?? fileURLToPath(new URL(`../demos/euler/195_inscribedcircles${fixture ? '_test' : ''}.ra`, import.meta.url));
let source = readFileSync(file, 'utf8').replace('Limit integer = 1053779', `Limit integer = ${limit}`);
const variant = option('variant') ?? 'base';
assert(['base', 'quotient', 'scalar'].includes(variant));
if (!fixture && variant !== 'base') {
    source = source.replace(/Qs = 1 to Qb array[\s\S]*?Ta = Ra isqrt copy\n/, '')
        .replace('Tb (Qv - 1)', '(Qb // Qv)').replace('Ta (Qv - 1)', '(Qa // Qv)');
    if (variant === 'scalar') source = source
        .replace(/  Ts = [\s\S]*?  Total \+= Hit sum/, `  for T in 1 to (Qb // N - N)
    if T mod 3 not equal 0 and (N gcd T) equal 1
      Total += Qb // (N * (N + T))
    end
  end`)
        .replace(/    Ns = [\s\S]*?    Total \+= Hit sum/, `    for N in 1 to ((Qa // T - T) // 3)
      if (N gcd T) equal 1
        Total += Qa // (T * (3 * N + T))
      end
    end`);
}
if (process.argv.includes('--phases')) source = source.replace('Total = 0', '"tables" print\nTotal = 0')
    .replace('for T in 1 to Qa', '"first-search" print\nfor T in 1 to Qa')
    .replace('Answer = Total', '"second-search" print\nAnswer = Total');
const diagnostics = new RuntimeDiagnostics(), output = [];
const start = performance.now();
const runtime = new Interpreter(line => output.push({ ms: performance.now() - start, line }), {
    compilation: !process.argv.includes('--reference'), testing: fixture, sourceId: file,
    loadModule(specifier, from) {
        const id = resolve(dirname(from ?? file), `${specifier}.ra`);
        return { id, source: readFileSync(id, 'utf8') };
    },
});
try {
    if (process.argv.includes('--diag')) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const ms = performance.now() - start, rssMiB = process.resourceUsage().maxRSS / 1024;
    const answer = fixture ? undefined : String(runtime.variables.get('Answer'));
    const golden = { 100: '1234', 1000: '22767', 10000: '359912', 1053779: '75085391' }[limit];
    if (!fixture && golden) assert.equal(answer, golden);
    if (fixture) {
        assert.equal(runtime.testResults.length, 2);
        assert(runtime.testResults.every(test => test.passed));
    }
    // Independent small-input oracle: enumerate sides adjacent to the 60-degree
    // angle, then check the third side and the exact squared inradius.
    if (!fixture && process.argv.includes('--oracle')) {
        assert(limit >= 1 && limit <= 20);
        let count = 0;
        for (let a = 1; a * a <= 12 * limit * limit; a++) {
            const maxB = Math.floor((3 * a * a + 2 * a - 1) / 4);
            for (let b = a + 1; b <= maxB; b++) {
                const c2 = a * a + b * b - a * b, c = Math.floor(Math.sqrt(c2));
                if (c * c !== c2) continue;
                const p = a + b + c;
                if (3 * a * a * b * b <= 4 * limit * limit * p * p) count++;
            }
        }
        assert.equal(answer, String(count));
    }
    console.log(JSON.stringify({ limit, variant, fixture, reference: process.argv.includes('--reference'), ms, rssMiB,
        answer, output, oracle: process.argv.includes('--oracle'), sourceHash: createHash('sha256').update(source).digest('hex'),
        ...(process.argv.includes('--diag') ? { diagnostics } : {}) }));
} finally { runtime.dispose(); }
