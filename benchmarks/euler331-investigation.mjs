import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
import { dirname, resolve } from 'node:path';

const root = process.env.RANK_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const { Interpreter, RuntimeDiagnostics } = await import(`${root}/packages/interpreter/out/index.js`);
const source = readFileSync(`${root}/benchmarks/experiments/euler331-original.ra`, 'utf8');
const definition = source.slice(source.indexOf('fun N turns'));
export function variant(name) {
    if (name === 'original') return definition;
    if (name === 'production') {
        const actual = readFileSync(`${root}/demos/euler/331_crossflips.ra`, 'utf8');
        return actual.slice(actual.indexOf('fun N turns'));
    }
    let code = definition
        .replaceAll('R += X\n      X += 1.0\n      R += X', 'R += 2.0 * X + 1.0\n      X += 1.0')
        .replaceAll('R += X\n        X += 1.0\n        R += X', 'R += 2.0 * X + 1.0\n        X += 1.0')
        .replace('R -= Y\n      Y -= 1.0\n      R -= Y', 'R -= 2.0 * Y - 1.0\n      Y -= 1.0');
    if (name === 'fused') return code;
    if (name === 'branchless') return code.replace(
        'if Parity equal 1.0\n        Fix += 2.0 * (C - 2.0 * Was)\n      else\n        Fix -= 2.0 * (C - 2.0 * Was)\n      end',
        'Delta = C - 2.0 * Was\n      Fix += (4.0 * Parity - 2.0) * Delta');
    if (['inner-plain', 'rows', 'sweep'].includes(name)) code = definition;
    else if (name !== 'inner') throw Error(`unknown variant ${name}`);
    code = code.replace('if 2.0 * X less Edge - R',
        'for 2.0 * X less Edge - R\n      if X at least Y\n        break\n      end')
        .replace(/    else\n      R -= (Y|2\.0 \* Y - 1\.0)/,
            '    end\n    if X less Y\n      R -= $1');
    if (name === 'rows' || name === 'sweep') {
      if (name === 'sweep') code = code.replace('      if X at least Y\n        break\n      end\n', '');
      return code.replace('    if X less Y\n      R -= Y',
        '    if X at least Y\n      break\n    end\n      R -= Y')
        .replace('      Parity = 1.0\n    end\n  end', '      Parity = 1.0\n  end');
    }
    return code;
}
function direct(n) {
    const cells = Array.from({ length: n }, (_, x) => Array.from({ length: n }, (_, y) =>
        Number(x * x + y * y >= (n - 1) ** 2 && x * x + y * y < n * n)));
    const parity = cells.map(row => row.reduce((sum, cell) => sum + cell, 0) % 2);
    return BigInt(cells.reduce((sum, row, x) => sum + row.reduce((s, cell, y) =>
        s + ((cell + parity[x] + parity[y]) % 2), 0), 0));
}
const [mode = 'compiled', input = '1000000', name = 'original'] = process.argv.slice(2);
if (mode === 'verify') {
    let checks = 0, fixtureTests = 0;
    for (const name of ['original', 'fused', 'branchless', 'inner', 'inner-plain', 'rows', 'sweep', 'production']) {
        for (const compilation of [true, false]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(variant(name));
                const cases = Array.from({ length: 64 }, (_, i) => [2 * (i + 1), direct(2 * (i + 1))]);
                cases.push([5, 3n], [7, 0n], [1000, 395253n], [10000, 38413231n]);
                for (const [n, expected] of cases) {
                    assert.equal(runtime.execute(`${n} turns`), expected, `${name}/${compilation}/${n}`);
                    checks++;
                }
            } finally { runtime.dispose(); }
            const fixture = `${root}/demos/euler/331_crossflips_test.ra`;
            const tests = new Interpreter(() => {}, { compilation, testing: true, sourceId: fixture,
                loadModule(spec, from) {
                    const id = resolve(dirname(from ?? fixture), spec.endsWith('.ra') ? spec : `${spec}.ra`);
                    return { id, source: id.endsWith('/331_crossflips.ra') ? variant(name) : readFileSync(id, 'utf8') };
                },
            });
            try {
                tests.execute(readFileSync(fixture, 'utf8'));
                assert.equal(tests.testResults.length, 2);
                assert(tests.testResults.every(t => t.passed), JSON.stringify(tests.testResults));
                fixtureTests += tests.testResults.length;
            } finally { tests.dispose(); }
        }
    }
    // Dense small sizes and large near-diagonal transitions against the old
    // boundary walk; these supplement the independent board oracle above.
    const baseline = new Interpreter(() => {}), actual = new Interpreter(() => {});
    let boundaryChecks = 0;
    try {
        baseline.execute(definition);
        actual.execute(variant('production'));
        const sizes = new Set(Array.from({ length: 2048 }, (_, i) => 2 * (i + 1)));
        for (let power = 12; power <= 19; power++) {
            const near = 2 * Math.floor(Math.SQRT2 * 2 ** power / 2);
            for (const delta of [-4, -2, 0, 2, 4]) sizes.add(near + delta);
        }
        for (const n of sizes) {
            assert.equal(actual.execute(`${n} turns`), baseline.execute(`${n} turns`), `boundary N=${n}`);
            boundaryChecks++;
        }
    } finally { baseline.dispose(); actual.dispose(); }
    console.log(JSON.stringify({ checks, fixtureTests, boundaryChecks, failures: 0 }));
} else {
    assert(['compiled', 'reference'].includes(mode));
    assert(input === 'full' || /^\d+$/.test(input));
    let executions = 0;
    const runtime = new Interpreter(() => {}, {
        compilation: mode === 'compiled', onScalarFunctionExecuted: () => executions++,
    });
    const diagnostics = new RuntimeDiagnostics();
    const program = input === 'full'
        ? source.slice(0, source.indexOf('fun N turns')) + variant(name)
        : `Answer = ${input} turns\n` + variant(name);
    try {
        if (process.env.MEMORY) { assert(global.gc, 'run with --expose-gc'); global.gc(); }
        const before = process.memoryUsage();
        const start = performance.now();
        diagnostics.run(() => runtime.execute(program));
        const record = { mode, input, variant: name, node: process.version,
            ms: performance.now() - start, rssMiB: process.resourceUsage().maxRSS / 1024,
            answer: String(runtime.variables.get(input === 'full' ? 'Sum' : 'Answer')), executions };
        if (process.env.MEMORY) {
            global.gc();
            const after = process.memoryUsage();
            record.memory = { before, after,
                retainedHeapDeltaMiB: (after.heapUsed - before.heapUsed) / 1024 ** 2,
                retainedArrayBufferDeltaMiB: (after.arrayBuffers - before.arrayBuffers) / 1024 ** 2 };
        }
        if (process.env.DIAGNOSTICS) record.diagnostics = diagnostics;
        if (process.env.SOURCE_OUT) writeFileSync(process.env.SOURCE_OUT, program);
        console.log(JSON.stringify(record));
    } finally { runtime.dispose(); }
}
