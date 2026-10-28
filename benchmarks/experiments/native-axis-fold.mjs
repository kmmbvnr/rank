// Serial microbenchmarks for reusable numeric axis reductions, after building.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const {Interpreter, RuntimeDiagnostics} = await import(pathToFileURL(resolve(option('runtime') ?? 'packages/interpreter/out/index.js')));
const name = option('case') ?? 'narrow';
const cases = {
    narrow: {rows: 20000, width: 4, axis: 1},
    wide: {rows: 32, width: 4096, axis: 1},
    strided: {rows: 4, width: 20000, axis: 0},
};
const {rows, width, axis} = cases[name] ?? assert.fail('unknown case');
const count = BigInt(rows * width);
const source = `use sequences
A = (1 to ${count}) reshape ${rows} ${width}
Mapped' = A + 1
Rows = Mapped sum axis ${axis}
Answer = Rows sum`;
const runtime = new Interpreter(() => {}, {compilation: !process.argv.includes('--reference')});
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start;
    assert.equal(runtime.variables.get('Answer'), count * (count + 1n) / 2n + count);
    console.log(JSON.stringify({case: name, ms, rssMiB: process.resourceUsage().maxRSS / 1024, diagnostics}));
} finally {runtime.dispose();}
