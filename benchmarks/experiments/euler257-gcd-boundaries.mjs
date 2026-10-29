// Compare a built native-kernel prototype with its unchanged parent.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
assert(option('probe'), 'provide --probe=/path/to/probe/out/index.js');
const parent = await import(pathToFileURL(resolve(option('runtime') ?? 'packages/interpreter/out/index.js')));
const probe = await import(pathToFileURL(resolve(option('probe'))));
const rows = [];
function run(api, source, mode = 'flag', options = {}) {
    const output = [], diagnostics = new api.RuntimeDiagnostics();
    const runtime = new api.Interpreter(line => output.push(line), options);
    const signal = new Int32Array(new SharedArrayBuffer(12));
    if (mode === 'cancel') signal[0] = 1;
    let error;
    const execute = () => {
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = { name: failure.name, kind: failure.rankKind, message: failure.message, formatted: failure.format?.() }; }
    };
    try {
        if (mode === 'budget') api.withDemandBudget(30, execute);
        else if (mode === 'inspection') api.withInterrupt(signal, execute, () => {});
        else if (mode === 'custom') api.withInterrupt({
            length: 1, load: () => 0, store: () => {}, exchange: () => 0, wait: () => {},
        }, execute);
        else api.withInterrupt(signal, execute);
        return { output, error, numberLoops: diagnostics.numberLoops,
            variables: [...runtime.variables].map(([name, value]) => [name, api.formatValue(value)]) };
    } finally { runtime.dispose(); }
}
const cases = [
    ['0', '0'], ['0', '34'], ['-34', '0'], ['34', '55'], ['-34', '55'], ['34', '-55'],
    ['-9007199254740991', '3'], ['9007199254740991', '9007199254740990'],
    ['9007199254740993', '3'], ['-9007199254740993', '9'],
];
for (const [a, b] of cases) {
    const source = `use numbers\nA = ${a}\nB = ${b}\nValue = 0\nfor I in 1 to 2\n Value = A gcd B\nend`;
    const before = run(parent, source), after = run(probe, source);
    assert.deepEqual(after, before);
    let x = BigInt(a), y = BigInt(b);
    x = x < 0n ? -x : x; y = y < 0n ? -y : y;
    while (y) [x, y] = [y, x % y];
    assert.equal(new Map(after.variables).get('Value'), String(x));
    if (BigInt(a) > 9007199254740991n || BigInt(a) < -9007199254740991n) assert.equal(after.numberLoops, 0);
    rows.push({ a, b, passed: true, expected: String(x) });
}
const source = `use numbers
A = 34
B = 55
Total = 0
Before = 0
After = 0
for I in 1 to 10000
 Before = I
 Total += A gcd B
 After = I
end`;
for (const mode of ['cancel', 'budget', 'inspection', 'custom']) {
    const before = run(parent, source, mode), after = run(probe, source, mode);
    assert.deepEqual(after, before, mode);
    if (mode === 'inspection' || mode === 'custom') assert.equal(after.numberLoops, 0);
    else assert(after.error);
    rows.push({ mode, passed: true, observation: after });
}
assert.deepEqual(run(probe, source, 'flag', { typedNativeCalls: false }),
    run(parent, source, 'flag', { typedNativeCalls: false }));
rows.push({ mode: 'typedNativeCalls=false', passed: true });
if (option('output')) writeFileSync(option('output'), JSON.stringify(rows, null, 2));
console.log(rows.length, 'native-kernel boundary comparisons passed');
