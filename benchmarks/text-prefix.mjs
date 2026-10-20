// npm run langium:generate && npx tsc -b tsconfig.build.json
// node benchmarks/text-prefix.mjs [top=10000] [num=10000000000000000]
// Profile with node --cpu-prof --cpu-prof-dir=/tmp benchmarks/text-prefix.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interpreter, parse, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const top = Number(process.argv[2] ?? 10000);
const num = BigInt(process.argv[3] ?? '10000000000000000');
assert.ok(Number.isSafeInteger(top) && top >= 2);
assert.ok(num >= 0n);
const input = readFileSync(new URL('../demos/euler/316_decimals.ra', import.meta.url), 'utf8');
const program = parse(input.replace('option Top integer = 999999', `Top = ${top}`)
    .replace('option Num integer = 10000000000000000', `Num = ${num}`));

// Independent border oracle: a waiting time sums powers for every prefix
// which is also a suffix, including the complete decimal representation.
function waiting(n) {
    const text = String(n);
    let total = 0n;
    for (let size = 1; size <= text.length; size++) {
        if (text.startsWith(text.slice(-size))) total += 10n ** BigInt(size);
    }
    return total - BigInt(text.length) + 1n;
}
assert.equal(waiting(535n), 1008n);
let expected = 0n;
for (let n = 2; n <= top; n++) expected += waiting(num / BigInt(n));
const runtime = new Interpreter(() => {});
try {
    const samples = [];
    for (let run = 0; run < 3; run++) {
        const diagnostics = new RuntimeDiagnostics();
        const start = performance.now();
        diagnostics.run(() => runtime.executeProgram(program));
        const ms = performance.now() - start;
        assert.equal(runtime.variables.get('Answer'), expected);
        samples.push({ ms, compiledLoops: diagnostics.compiledLoops, numberLoops: diagnostics.numberLoops,
            fallbacks: diagnostics.fallbacks });
    }
    console.log(JSON.stringify({ node: process.version, top, num: String(num), answer: String(expected),
        samples, medianMs: samples.map(s => s.ms).sort((a, b) => a - b)[1],
        maxRSSMiB: process.resourceUsage().maxRSS / 1024 }));
} finally { runtime.dispose(); }
