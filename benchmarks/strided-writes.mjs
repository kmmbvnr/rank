// Run sequential fresh processes. Writer timing excludes prime generation and allocation.
// node benchmarks/strided-writes.mjs [--runtime=/baseline/out] [--mode=writer|loop|full] [--n=10000000]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const directory = resolve(option('runtime') ?? new URL('../packages/interpreter/out', import.meta.url).pathname);
const load = file => import(pathToFileURL(`${directory}/${file}.js`).href);
const n = Number(option('n') ?? 10000000), mode = option('mode') ?? 'writer';
assert.ok(Number.isSafeInteger(n) && n >= 100);
const { Interpreter, RuntimeDiagnostics } = await load('index');
const { filledArray, writeIntegerSelection, readArrayItem } = await load('array-storage');
const { ownedStorage } = await load('array-storage-state');
const { primeRange } = await load('prime-sequence');
let array, answer, writes = 0, ms;
const diagnostics = new RuntimeDiagnostics();
if (mode === 'writer') {
    const primes = [...primeRange(undefined, false, BigInt(n), true)];
    array = filledArray(0n, [n + 1]);
    const start = performance.now();
    for (const prime of primes) {
        const p = Number(prime), count = Math.floor(n / p);
        writes += count;
        writeIntegerSelection(array, count, index => p + index * p, prime, '=', { offset: p, stride: p });
    }
    ms = performance.now() - start;
    // Independently factor selected inputs; do not materialize the destination.
    for (const value of [2, 49, 97, n - 1, n]) {
        let rest = value, largest = 1;
        for (let p = 2; p * p <= rest; p++) while (rest % p === 0) { largest = p; rest /= p; }
        largest = Math.max(largest, rest);
        assert.equal(readArrayItem(array, value), BigInt(largest));
    }
} else {
    assert.ok(['loop', 'full'].includes(mode));
    const runtime = new Interpreter(() => {});
    try {
        const source = mode === 'loop' ? `use sequences\nN = ${n}\nS = array shape (N + 1) fill 0\nfor P in primes to N\n S (P to N by P) = P\nend`
            : readFileSync(new URL('../demos/euler/549_divisibilityfactorials.ra', import.meta.url), 'utf8')
                .replace('arg N integer = 100000000', `N = ${n}`).replace('Answer print', '');
        const start = performance.now();
        const run = () => runtime.execute(source);
        if (process.argv.includes('--diagnostics')) diagnostics.run(run); else run();
        ms = performance.now() - start;
        array = runtime.variables.get('S');
        assert.equal(readArrayItem(array, 10), 5n);
        if (mode === 'full') {
            answer = String(runtime.variables.get('Answer'));
            const expected = { 100: '2012', 10000000: '5494373412573', 100000000: '476001479068717' }[n];
            assert.ok(expected, 'full mode requires a verified input');
            assert.equal(answer, expected);
        }
    } finally { runtime.dispose(); }
}
const storage = ownedStorage.get(array)?.typed;
console.log(JSON.stringify({ mode, n, ms, writes: writes || undefined, nsPerCell: writes ? ms * 1e6 / writes : undefined,
    answer, storage: storage?.constructor.name, bytes: storage?.byteLength, maxRssMiB: process.resourceUsage().maxRSS / 1024,
    node: process.version, cpu: cpus()[0]?.model, ...(process.argv.includes('--diagnostics') ? { diagnostics } : {}) }));
