// npm run build
// node --max-old-space-size=6144 benchmarks/large-membership.mjs --size=50000000 --mode=array
// Run each sample in a fresh process. Modes: array, loop, function.
// --warmup=3 measures after three untimed membership operations.
// --runtime=/absolute/path/to/interpreter/out/index.js also measures an older build.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const options = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const size = Number(options.size ?? 1000000);
const mode = options.mode ?? 'array';
const warmup = Number(options.warmup ?? 0);
assert.ok(Number.isSafeInteger(size) && size >= 1000);
assert.ok(Number.isSafeInteger(warmup) && warmup >= 0);
assert.ok(['array', 'loop', 'function'].includes(mode));
const module = options.runtime ? pathToFileURL(options.runtime) : new URL('../packages/interpreter/out/index.js', import.meta.url);
const { Interpreter, RuntimeDiagnostics, isRankArray } = await import(module.href);
const runtime = new Interpreter(undefined, { scalarEntryCompilation: false });
const diagnostics = new RuntimeDiagnostics();
const expected = Array.from({ length: 1000 }, (_, i) => ((i + 1) * 5 + 3) % 7 === 0)
    .concat([false, false, true, false, false]);
const programs = {
    array: 'B in A',
    loop: 'Hits = 0\nfor Value in B\n if Value in A\n  Hits += 1\n end\nend\nHits',
    function: 'A mask',
};
try {
    const start = performance.now();
    runtime.execute(`use sequences
A = (1 to ${size} array) * 7
B = concat ((1 to 1000 array) * 5 + 3) (array 0 -7 ${size * 7} ${size * 7 + 1} ${size * 7 + 7})
Empty = 0 till 0 array
fun Q mask
 Candidates = concat Q Empty
 return B in Candidates
end`);
    const setupMs = performance.now() - start;
    for (let round = 0; round < warmup; round++) runtime.execute(programs[mode]);
    const indexed = performance.now();
    let result;
    try { result = diagnostics.run(() => runtime.execute(programs[mode])); }
    catch (error) {
        console.log(JSON.stringify({ node: process.version, size, mode, warmup, setupMs, membershipMs: performance.now() - indexed,
            error: String(error), rssMiB: process.memoryUsage().rss / 2 ** 20 }));
        process.exitCode = 1;
        // Permit failed baseline samples without reporting a correctness pass.
    }
    if (process.exitCode !== 1) {
        const membershipMs = performance.now() - indexed;
        const hits = expected.filter(Boolean).length;
        if (mode === 'loop') {
            assert.equal(result, BigInt(hits));
            assert.ok(diagnostics.compiledLoops > 0, 'must exercise integer membership compilation');
        } else {
            assert.ok(isRankArray(result));
            assert.deepEqual(result.items, expected);
            if (mode === 'function') assert.ok(diagnostics.compiledArrayFunctions > 0, 'must exercise fused membership');
        }
        console.log(JSON.stringify({ node: process.version, size, mode, warmup, setupMs, membershipMs, hits,
            rssMiB: process.memoryUsage().rss / 2 ** 20, peakRssMiB: process.resourceUsage().maxRSS / 1024,
            compiledLoops: diagnostics.compiledLoops, compiledArrayFunctions: diagnostics.compiledArrayFunctions }));
    }
} finally { runtime.dispose(); }
