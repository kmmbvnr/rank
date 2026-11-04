import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const size = 262144, rounds = 32;
const cases = Object.fromEntries([
    ['integer', '1', 'Cells 0 += 1', BigInt(rounds + 1)],
    ['wide', '9007199254740993', 'Cells 0 += 1', 9007199254740993n + BigInt(rounds)],
    ['text', '"old"', 'Cells 0 = "new"', 'new'],
].map(([name, initial, write, expected]) => [name, [`fun Size solve
 Cells = array shape Size fill ${initial}
 Spare = Cells
 for I in 0 till ${rounds}
  Spare = Cells
  Spare = array shape 1 fill ${initial}
  ${write}
 end
 return Cells 0
end`, expected]]));
cases.returns = [`fun Size build
 Cells = array shape Size fill 1
 Cells 0 = 2
 return Cells
end
fun Size update
 Cells = Size build
 Cells 0 = 3
 return Cells
end
fun Size solve
 Total = 0
 Cells = array shape 1 fill 0
 for I in 0 till ${rounds}
  Cells = Size update
  Cells 0 = 4
  Total += Cells 0
 end
 return Total
end`, 4n * BigInt(rounds)];
cases.live = [`fun Size solve
 Cells = array shape Size fill 1
 Saved = Cells
 Cells 0 = 9
 return (Cells 0) + Saved 0
end`, 10n];

const [root, name, backend] = process.argv.slice(2);
if (name) {
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')));
    const { referenceCompilerOptions } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/interpreter-options.js')));
    let compiled = 0;
    const options = { onScalarFunctionExecuted: () => compiled++ };
    const runtime = new Interpreter(undefined, backend === 'reference' ? referenceCompilerOptions(options) : options);
    const [source, expected] = cases[name];
    runtime.execute(source + `
fun Size bridge
 Result = ${typeof expected === 'string' ? '""' : '0'}
 for I in 1 to 1
  Result = Size solve
 end
 return Result
end`);
    const solve = runtime.variables.get('bridge');
    for (let i = 0; i < 4; i++) assert.equal(solve.call([BigInt(size)]), expected);
    const samples = [];
    for (let i = 0; i < 7; i++) {
        global.gc?.();
        const diagnostics = new RuntimeDiagnostics();
        const start = performance.now();
        assert.equal(diagnostics.run(() => solve.call([BigInt(size)])), expected);
        samples.push({ ms: performance.now() - start, copies: diagnostics.cowCopies, cells: diagnostics.cowCopiedCells });
    }
    samples.sort((a, b) => a.ms - b.ms);
    console.log(JSON.stringify({ name, backend, ...samples[3], compiled,
        rssMiB: process.resourceUsage().maxRSS / 1024, node: process.version, cpu: cpus()[0].model }));
    runtime.dispose();
} else {
    for (const name of Object.keys(cases)) for (const backend of ['reference', 'compiled']) {
        const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), root ?? '.', name, backend], { encoding: 'utf8' });
        if (child.status !== 0) throw new Error(child.stderr || child.stdout);
        process.stdout.write(child.stdout);
    }
}
