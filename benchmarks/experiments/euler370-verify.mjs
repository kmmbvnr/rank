import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter, RuntimeDiagnostics, assertPatched} from '../euler370-investigation.mjs';
import {withInterrupt, withDemandBudget, DemandBudgetExhausted} from '../../packages/interpreter/out/interrupt.js';

const source = readFileSync(new URL('../../demos/euler/370_triangles.ra', import.meta.url), 'utf8')
    .replace('use io', '').replace('use cli', '').replace(/arg Limit integer = \d+/, '')
    .replace('Answer = Limit triangles', '').replace('Answer print', '');
const gcd = (a, b) => b ? gcd(b, a % b) : a;
function oracle(limit) {
    let total = 0;
    for (let p = 1; 3*p*p <= limit; p++) {
        for (let q = p; q*q < p*p+p*q && p*p+p*q+q*q <= limit; q++) {
            if (gcd(p, q) === 1) total += Math.floor(limit/(p*p+p*q+q*q));
        }
    }
    return BigInt(total);
}
let checks = 0;
for (const compilation of [false, true]) {
    const runtime = new Interpreter(() => {}, {compilation});
    try {
        runtime.execute(source);
        const inputs = [...Array.from({length: 100}, (_, i) => i+3), 999, 1000, 1001, 10000, 100000, 1000000];
        for (const limit of inputs) {
            assert.equal(runtime.execute(`${limit} triangles`), oracle(limit)); checks++;
        }
    } finally { runtime.dispose(); }
}
// Reuse one compiled function across changing execution scopes. The selection
// must be made at invocation, rather than when the function is first compiled.
const runtime = new Interpreter(() => {}, {scalarEntryCompilation: false}), diagnostics = new RuntimeDiagnostics();
try {
    runtime.execute(`fun N total
 S = 0
 for I in 1 to N
  S += I
 end
 return S
end`);
    assert.equal(runtime.execute('100 total'), 5050n); checks++;
    const flag = new Int32Array(1); flag[0] = 1;
    assert.throws(() => withInterrupt(flag, () => diagnostics.run(() => runtime.execute('1000000 total'))), /Interrupted/); checks++;
    assert.throws(() => withDemandBudget(30, () => runtime.execute('1000000 total')), DemandBudgetExhausted); checks++;
    assert.equal(runtime.execute('100 total'), 5050n); checks++;
    assert.equal(runtime.execute(`S = 9007199254740990
for I in 1 to 10
 S += I
end
S`), 9007199254741045n); checks++;
    flag[0] = 1;
    assert.throws(() => withInterrupt(flag, () => runtime.execute(`A = array shape 10000 fill 0
S = 0
Last = 0
Done = 0
try
 for I in 0 till 10000
  A I = I
  S += I
  Last = I
 end
finally
 Done = 1
end`)), /Interrupted/); checks++;
    const last = runtime.variables.get('Last');
    assert.ok(last > 0n);
    assert.equal(runtime.variables.get('S'), last * (last+1n)/2n);
    assert.equal(runtime.variables.get('Done'), 1n); checks += 3;
    assert.ok(diagnostics.numberLoops > 0);
    assertPatched();
} finally { runtime.dispose(); }
console.log(JSON.stringify({checks, status: 'passed'}));
