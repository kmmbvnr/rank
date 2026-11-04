import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
if (process.env.EARLY_GUARD) await import(process.env.EARLY_GUARD === 'static'
    ? './euler393-disabled-entry.mjs' : './euler393-entry-guard.mjs');
const {Interpreter} = await import('../../packages/interpreter/out/index.js');
// Direct ant moves: one distinct destination per ant, no reversed edge.
// This oracle uses neither row masks nor the two-matching representation.
function enumerate(n) {
    const count = n * n, destination = Array(count).fill(-1), occupied = Array(count).fill(false);
    const adjacent = Array.from({length: count}, (_, p) => {
        const r = Math.floor(p / n), c = p % n;
        return [r > 0 ? p - n : -1, r + 1 < n ? p + n : -1,
            c > 0 ? p - 1 : -1, c + 1 < n ? p + 1 : -1].filter(q => q >= 0);
    });
    function visit(p) {
        if (p === count) return 1n;
        let result = 0n;
        for (const q of adjacent[p]) {
            if (occupied[q] || destination[q] === p) continue;
            destination[p] = q; occupied[q] = true;
            result += visit(p + 1);
            destination[p] = -1; occupied[q] = false;
        }
        return result;
    }
    return visit(0);
}
const small = Array.from({length: 5}, (_, n) => [n, enumerate(n)]);
assert.deepEqual(small.map(([, answer]) => answer), [1n,0n,2n,0n,88n]);
const checks = [...small,[5,0n],[6,207408n],[8,22902801416n]];
let comparisons = 0;
for (const file of ['demos/euler/393_ants.ra', 'benchmarks/experiments/euler393-original.ra', 'benchmarks/experiments/euler393-layers.ra',
    'benchmarks/experiments/euler393-symmetry.ra']) {
    const source = readFileSync(file, 'utf8');
    for (const compilation of [false,true]) for (const [n, expected] of checks) {
        const runtime = new Interpreter(() => {}, {compilation, args: [`--n=${n}`]});
        try {
            runtime.execute(source);
            assert.equal(runtime.variables.get('Answer'), expected, `${file}, N=${n}, compilation=${compilation}`);
            comparisons++;
        } finally {runtime.dispose();}
    }
}
console.log(JSON.stringify({comparisons, directOracle: small.map(([n,v]) => [n,String(v)]),
    earlyGuard: process.env.EARLY_GUARD || false}));
const {withInterrupt} = await import('../../packages/interpreter/out/interrupt.js');
for (const defineUnderInspection of [false,true]) {
    let compiledCalls = 0;
    const runtime = new Interpreter(() => {}, {onIntegerLoopExecuted: () => compiledCalls++});
    const signal = new Int32Array(new SharedArrayBuffer(12));
    try {
        const define = () => runtime.execute(`fun N helper
  Total = 0
  for I in 1 to N
    Total += I
  end
  return Total
end`);
        if (defineUnderInspection) withInterrupt(signal, define, () => {}); else define();
        withInterrupt(signal, () => runtime.execute('Answer = 1000 helper'), () => {});
        assert.equal(runtime.variables.get('Answer'), 500500n);
        assert.equal(compiledCalls, 0);
        runtime.execute('Answer = 1000 helper');
        assert.equal(runtime.variables.get('Answer'), 500500n);
        assert.equal(runtime.compiler.enabled, true, 'restore compiled capabilities after inspection');
    } finally {runtime.dispose();}
}
console.log(JSON.stringify({inspectionRecoveryChecks: 2}));
