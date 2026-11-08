import assert from 'node:assert/strict';
import { readArrayItem } from '../packages/interpreter/out/array-storage.js';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';
const size = Number(process.argv[2] ?? 262144);
const repeats = Number(process.argv[3] ?? 8);
const compilation = process.env.COMPILED !== '0';
const accumulate = process.env.ACCUMULATE !== '0';
const modulus = 1000000007n;
const expected = Array(4096).fill(1n);
for (let turn = 0; turn < repeats; turn++) {
    const previous = [...expected];
    for (let index = 0; index < size; index++) {
        const key = index % 4096, weight = BigInt(index % 97 + 1000000000);
        expected[key] = (accumulate ? expected[key] : previous[key]) * weight % modulus;
    }
}
const runtime = new Interpreter(() => {}, { compilation });
const diagnostics = new RuntimeDiagnostics();
try {
    runtime.execute(`Count = ${size}
Keys = (0 till Count) mod 4096
Weights = (0 till Count) mod 97 + 1000000000
Values = array shape 4096 fill 1`);
    const start = performance.now();
    diagnostics.run(() => runtime.execute(`for I in 1 to ${repeats}
 Values Keys *= Weights mod ${modulus} ${accumulate ? '.accumulate' : ''}
 Done = I
end`));
    const ms = performance.now() - start;
    assert.equal(runtime.execute('Values sum'), expected.reduce((a, b) => a + b));
    for (let index = 0; index < expected.length; index++) assert.equal(readArrayItem(runtime.variables.get('Values'), index), expected[index]);
    console.log(JSON.stringify({ size, repeats, compilation, accumulate, ms,
        maxRssMiB: process.resourceUsage().maxRSS / 1024, numberLoops: diagnostics.numberLoops,
        node: process.version, arch: process.arch }));
} finally { runtime.dispose(); }
