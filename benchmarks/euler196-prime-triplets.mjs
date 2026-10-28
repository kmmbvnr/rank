// Run each sample in a fresh process after building the interpreter.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const { Interpreter, RuntimeDiagnostics } = await import(option('runtime')
    ? pathToFileURL(option('runtime')).href : '../packages/interpreter/out/index.js');
const n1 = Number(option('n1') ?? 5678027), n2 = Number(option('n2') ?? 7208785);
const fixture = process.argv.includes('--fixture'), reference = process.argv.includes('--reference');
const variant = option('variant') ?? 'base';
assert(['base', 'tail'].includes(variant));
const file = fileURLToPath(new URL(`../demos/euler/196_primetriplets${fixture ? '_test' : ''}.ra`, import.meta.url));
function transform(source) {
    source = source.replace('N1 integer = 5678027', `N1 integer = ${n1}`)
        .replace('N2 integer = 7208785', `N2 integer = ${n2}`);
    // Experimental control only; the shipped demo remains unchanged.
    if (variant === 'tail') source = source.replace('  Hit = (Mk equal 1) indices\n  Answer += (Row0 + Hit) sum', `  Count = 0
  IndexSum = 0
  for C in 0 till N
    Count += Mk C
    IndexSum += C * Mk C
  end
  Answer += Row0 * Count + IndexSum`);
    if (process.argv.includes('--phases')) source = source.replace('  Offs =', '  "sieve" print\n  Offs =')
        .replace('  Row0 =', '  "scan" print\n  Row0 =');
    return source;
}
const source = transform(readFileSync(file, 'utf8'));
const diagnostics = new RuntimeDiagnostics(), output = [];
const start = performance.now();
const runtime = new Interpreter(line => output.push({ ms: performance.now() - start, line }), {
    compilation: !reference, testing: fixture, sourceId: file,
    loadModule(specifier, from) {
        const id = resolve(dirname(from ?? file), `${specifier}.ra`);
        return { id, source: transform(readFileSync(id, 'utf8')) };
    },
});
try {
    if (process.argv.includes('--diag')) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const ms = performance.now() - start, rssMiB = process.resourceUsage().maxRSS / 1024;
    const answer = fixture ? undefined : String(runtime.variables.get('Answer'));
    if (fixture) {
        assert.equal(runtime.testResults.length, 2);
        assert(runtime.testResults.every(test => test.passed));
    } else {
        if (n1 === 5678027 && n2 === 7208785) assert.equal(answer, '322303240771079935');
        if (n1 === 8 && n2 === 9) assert.equal(answer, '97');
        if (n1 === 10000 && n2 === 8) assert.equal(answer, '950007679');
        if (process.argv.includes('--oracle')) {
            assert(n1 >= 3 && n2 >= 3 && n1 <= 2000 && n2 <= 2000);
            assert.equal(answer, String(oracle(n1) + oracle(n2)));
        }
    }
    console.log(JSON.stringify({ n1, n2, variant, fixture, reference, ms, rssMiB, answer, output,
        sourceHash: createHash('sha256').update(source).digest('hex'),
        ...(process.argv.includes('--diag') ? { diagnostics } : {}) }));
} finally { runtime.dispose(); }

// Independent small oracle: trial-divide each value, then inspect the graph of
// neighbouring prime cells, rather than sieve/mark the five-row strip.
function oracle(n) {
    const value = (r, c) => r * (r - 1) / 2 + 1 + c;
    function prime(v) {
        if (v < 2) return false;
        for (let d = 2; d * d <= v; d++) if (v % d === 0) return false;
        return true;
    }
    function neighbours(r, c) {
        const result = [];
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            const row = r + dr, col = c + dc;
            if ((dr || dc) && row >= 1 && col >= 0 && col < row && prime(value(row, col))) result.push([row, col]);
        }
        return result;
    }
    let sum = 0;
    for (let c = 0; c < n; c++) {
        if (!prime(value(n, c))) continue;
        const adjacent = neighbours(n, c);
        if (adjacent.length >= 2 || adjacent.some(([r, col]) => neighbours(r, col).length >= 2)) sum += value(n, c);
    }
    return sum;
}
