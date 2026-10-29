// Independent recurrence validation and full-input source/runtime comparisons.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
const runtimePath = resolve(option('runtime') ?? 'packages/interpreter/out/index.js');
const { Interpreter, RuntimeDiagnostics, withInterrupt } = await import(pathToFileURL(runtimePath));
const main = fileURLToPath(new URL('../demos/euler/258_laggedfibonacci.ra', import.meta.url));
const shipping = readFileSync(main, 'utf8');
const originalSquare = 'for J in 0 till Deg\n        Ix = I + J\n        Acc = Tmp Ix + Ri * Res J';
const symmetricSquare = 'for J in I till Deg\n        Ix = I + J\n        Product = Ri * Res J\n'
    + '        if J not equal I\n          Product += Product\n        end\n'
    + '        Acc = Tmp Ix + Product';
assert(shipping.includes(symmetricSquare), 'update the frozen comparison when the demo changes');
const original = shipping.replace(symmetricSquare, originalSquare)
    .replace('      rem Off-diagonal products occur twice.\n', '');
const variants = {
    original, shipping,
    flags: original.replace('for B in (N binary len - 2) to 0 by -1',
        'Flags = N bit (0 till (N binary len) array)\nfor B in (Flags len - 2) to 0 by -1')
        .replace('if N bit B', 'if Flags B'),
};
variants.symmetric = variants.flags.replace(originalSquare, symmetricSquare);
variants.diagonal = variants.flags.replace(
    /  for I in 0 till Deg\n    Ri = Res I[\s\S]*?\n  end\n  for I in \(2 \* Deg - 2\)/,
    `  for K in 0 to (2 * Deg - 2)
    Acc = 0
    Lo = (K - Deg + 1) max 0
    Hi = (K // 2) min (Deg - 1)
    for I in Lo to Hi
      J = K - I
      Product = Res I * Res J
      if I not equal J
        Product += Product
      end
      Acc = (Acc + Product) mod Mod
    end
    Tmp K = Acc
  end
  for I in (2 * Deg - 2)`);

function execute(variant, n, mod, compilation, fixture = false) {
    assert(Object.hasOwn(variants, variant), `unknown variant: ${variant}`);
    const file = fixture ? main.replace('.ra', '_test.ra') : main;
    const source = variants[variant]
        .replace('arg N integer = 1000000000000000000', `arg N integer = ${n}`)
        .replace('arg Mod integer = 20092010', `arg Mod integer = ${mod}`);
    const output = [], diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(line => output.push(line), {
        compilation, testing: fixture, sourceId: file,
        loadModule(specifier, from) {
            const id = resolve(dirname(from ?? file), `${specifier}.ra`);
            return { id, source: id === main ? source : readFileSync(id, 'utf8') };
        },
    });
    try {
        const start = performance.now();
        const run = () => diagnostics.run(() => runtime.execute(fixture ? readFileSync(file, 'utf8') : source));
        if (flag('interrupt')) withInterrupt(new Int32Array(new SharedArrayBuffer(12)), run);
        else run();
        const ms = performance.now() - start;
        const answer = fixture ? undefined : String(runtime.variables.get('Answer'));
        if (fixture) {
            assert.equal(runtime.testResults.length, 1);
            assert(runtime.testResults.every(test => test.passed));
        } else {
            assert.deepEqual(output, [answer]);
            if (n === '1000000000000000000' && mod === '20092010') assert.equal(answer, '12747994');
        }
        return { variant, n, mod, compilation, fixture, ms, answer,
            runtime: runtimePath, sourceHash: createHash('sha256').update(source).digest('hex'),
            rssMiB: process.resourceUsage().maxRSS / 1024, diagnostics };
    } finally { runtime.dispose(); }
}

if (flag('verify')) {
    // Independent direct recurrence, without polynomial multiplication or bits.
    let checks = 0;
    for (const mod of [1n, -97n, 97n, 20092010n, 10n ** 20n]) {
        const modulo = value => {
            const remainder = value % mod;
            return remainder !== 0n && (remainder < 0n) !== (mod < 0n) ? remainder + mod : remainder;
        };
        const terms = Array(2000).fill(1n);
        for (let n = 2000; n <= 100000; n++) terms[n] = modulo(terms[n - 2000] + terms[n - 1999]);
        for (const n of [0, 1, 1999, 2000, 2001, 3999, 4000, 10000, 100000]) {
            // The diagonal control discards sparse-row skipping and is slower;
            // keep the reference oracle focused on the candidate variants.
            for (const variant of ['original', 'flags', 'symmetric', 'shipping']) for (const compilation of [true, false]) {
                const result = execute(variant, String(n), String(mod), compilation);
                assert.equal(result.answer, String(modulo(terms[n])), JSON.stringify({ variant, n, mod: String(mod), compilation }));
                checks++;
            }
        }
    }
    console.log(JSON.stringify({ checks }));
} else {
    console.log(JSON.stringify(execute(option('variant') ?? 'shipping',
        option('N') ?? '1000000000000000000', option('Mod') ?? '20092010',
        !flag('reference'), flag('fixture'))));
}
