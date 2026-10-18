// Build first: npm run langium:generate && npx tsc -b tsconfig.build.json
// --runtime=/absolute/path/to/out/index.js benchmarks another checkout.
// Initialization and loop timings exclude process startup; fresh CLI timing is separate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { pathToFileURL } from 'node:url';
const path = process.argv.find(x => x.startsWith('--runtime='))?.slice(10);
const { Interpreter, RuntimeDiagnostics } = await import(path ? pathToFileURL(path).href : '../packages/interpreter/out/index.js');
const original = process.argv.includes('--original-bound');
const source = readFileSync(new URL('./fixtures/cuboid-layers.ra',import.meta.url),'utf8')
  .replace('R = Half isqrt + 1', original ? 'R = (Half // 2) isqrt + 1' : 'R = Half isqrt + 1');
const cut = source.indexOf('for Val len'), setup = source.slice(0,cut), loop = source.slice(cut);
// Independent scalar formula for cuboid dimensions and every layer number.
const expected = [], limit = 20000, tally = new Uint32Array(limit+1);
let checksum = 0n;
for (let a = 1; 6*a*a <= limit; a++)
  for (let b = a; b <= (original ? Math.floor(Math.sqrt(limit/4))+1 : Infinity) && 2*(2*a*b+b*b) <= limit; b++)
    for (let c = b; 2*(a*b+b*c+c*a) <= limit; c++)
      for (let n = 1; ; n++) {
        const value = 2*(a*b+b*c+c*a) + 4*(n-1)*(a+b+c+n-2);
        if (value > limit) break;
        tally[value]++;
        expected[n-1] = (expected[n-1] ?? 0) + 1;
        checksum += BigInt(value);
      }
expected.push(0);
if (!original) assert.equal(tally.findIndex(x => x === 1000),18522);
console.log(JSON.stringify({ variant: original ? 'original bound' : 'corrected bound', node: process.version, cpu: cpus()[0]?.model, cuboids: expected[0],
  values: expected.reduce((a,b) => a+b,0), checksum: String(checksum), timing: 'setup and loop parse/execution separately; startup excluded' }));
for (let trial = 0; trial < 3; trial++) {
  const output = [], runtime = new Interpreter(line => output.push(Number(line)));
  let start = performance.now(); runtime.execute(setup); const setupMs = performance.now()-start;
  start = performance.now(); const cpu = process.cpuUsage(); runtime.execute(loop); const loopMs = performance.now()-start;
  const usage = process.cpuUsage(cpu), loopCpuMs = (usage.user+usage.system)/1000;
  assert.deepEqual(output, expected);
  console.log(JSON.stringify({ trial, setupMs, loopMs, loopCpuMs, totalMs: setupMs+loopMs }));
  runtime.dispose();
}
// Instrumented checksum run is deliberately outside the timed trials.
const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
runtime.execute(setup+'\nChecksum = 0');
diagnostics.run(() => runtime.execute(loop.replace('Val len print', 'Checksum += Val sum')));
assert.equal(runtime.execute('Checksum'), checksum);
console.log(JSON.stringify({ diagnostics }));
runtime.dispose();
