// Build first. --runtime=/absolute/path/to/packages/interpreter/out/index.js
// --full runs the default Euler 553/559 inputs once; otherwise three samples
// at N=3000/5000. Each sample runs in a fresh process, with setup inside timing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const runtime = process.argv.find(arg => arg.startsWith('--runtime='))?.slice(10)
  ?? fileURLToPath(new URL('../packages/interpreter/out/index.js', import.meta.url));
const full = process.argv.includes('--full');
const workloads = [
  { id: '559_permutedmatrices', n: full ? 50000 : 5000, answer: full ? '684724920' : '363762335' },
  { id: '553_powersetsofpowersets', n: full ? 10000 : 3000, answer: full ? '57717170' : '91201233' },
];
if (process.argv.includes('--worker')) {
  const workload = workloads[Number(process.argv.at(-1))];
  const { Interpreter } = await import(pathToFileURL(runtime).href);
  const source = readFileSync(new URL(`../demos/euler/${workload.id}.ra`, import.meta.url), 'utf8')
    .replace(/option N integer = \d+/, `option N integer = ${workload.n}`);
  const interpreter = new Interpreter(() => {});
  try {
    const start = performance.now();
    interpreter.execute(source);
    const ms = performance.now() - start;
    const answer = String(interpreter.variables.get('Answer'));
    if (workload.answer) assert.equal(answer, workload.answer);
    console.log(JSON.stringify({ id: workload.id, n: workload.n, ms, answer }));
  } finally { interpreter.dispose(); }
} else {
  console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, runtime,
    timing: 'fresh process; parse and execution; process startup excluded', full }));
  for (let trial = 0; trial < (full ? 1 : 3); trial++) for (let index = 0; index < workloads.length; index++) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--runtime=${runtime}`,
      ...(full ? ['--full'] : []), '--worker', String(index)], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || `worker exited ${result.status}`);
    console.log(JSON.stringify({ trial, ...JSON.parse(result.stdout) }));
  }
}
