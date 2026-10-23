import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Interpreter, parse } from '../packages/interpreter/out/index.js';

// Build current sources first: npx tsc -b tsconfig.build.json
// Each measured sample runs in a fresh process after one warmup.
const variant = process.argv.find(arg => arg.startsWith('--worker='))?.split('=')[1];
const variants = ['materialized', 'streamed', 'streamed-hoisted'];
const samples = Number(process.env.SAMPLES ?? 5);
const safe = `fun Q safe rank 1
  N = Q len
  Rows = 0 till N array
  Up = (Q + Rows) unique len
  Down = (Q - Rows) unique len
  return Up equal N and Down equal N
end`;
const hoisted = `fun Q safe rank 1
  Up = (Q + Columns) unique len
  if Up not equal 8
    return false
  end
  return (Q - Columns) unique len equal 8
end`;
const render = `Solutions len print
Mask = Solutions Columns outer equal
Boards = Mask "Q" "." choose
for Board i in Boards
  i + 1 print
  for Row in Board
    Row join " " print
  end
  "" print
end`;

if (variant) {
  assert(variants.includes(variant));
  const dense = variant === 'materialized';
  const stages = [
    ['setup', `use algo\nuse sequences\nuse text\nuse io\nColumns = 0 till 8 array\n${variant === 'streamed-hoisted' ? hoisted : safe}`],
    ['candidates', `Candidates = Columns permutations${dense ? ' array' : ''}`],
    ['filter', `Valid = Candidates filter safe${dense ? ' rank 1' : ''}`],
    ['copy', 'Solutions = Valid copy'],
    ['render', render],
  ].map(([name, source]) => [name, parse(source)]);
  const run = () => {
    const output = [];
    const runtime = new Interpreter(line => output.push(line));
    const times = {};
    const memory = {};
    if (!process.env.PROFILE) global.gc();
    const before = process.memoryUsage().heapUsed;
    for (const [name, program] of stages) {
      const start = performance.now();
      runtime.executeProgram(program);
      times[name] = performance.now() - start;
      if (!process.env.PROFILE) global.gc();
      memory[name] = (process.memoryUsage().heapUsed - before) / 2 ** 20;
    }
    const solutions = runtime.variables.get('Solutions');
    assert.deepEqual(solutions.shape, [92, 8]);
    const rows = Array.from({ length: 92 }, (_, row) =>
      Array.from({ length: 8 }, (_, col) => Number(solutions.itemAt?.(row * 8 + col) ?? solutions.items[row * 8 + col])));
    assert.equal(new Set(rows.map(row => row.join(','))).size, 92);
    for (const row of rows) {
      assert.equal(new Set(row).size, 8);
      assert.equal(new Set(row.map((col, i) => col + i)).size, 8);
      assert.equal(new Set(row.map((col, i) => col - i)).size, 8);
    }
    assert.equal(output[0], '92');
    assert.equal(output.length, 921);
    return { times, retainedHeapMiB: memory, rows, output };
  };
  run();
  console.log(JSON.stringify(run()));
} else {
  const result = { node: process.version, cpu: cpus()[0].model, samples, variants: {} };
  let oracle;
  for (const name of variants) {
    const runs = [];
    for (let i = 0; i < samples; i++) {
      const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), `--worker=${name}`], { encoding: 'utf8' });
      assert.equal(child.status, 0, child.stderr);
      const run = JSON.parse(child.stdout);
      oracle ??= { rows: run.rows, output: run.output };
      assert.deepEqual(run.rows, oracle.rows);
      assert.deepEqual(run.output, oracle.output);
      delete run.rows;
      delete run.output;
      runs.push(run);
    }
    const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    result.variants[name] = {
      medianMs: Object.fromEntries(Object.keys(runs[0].times).map(stage => [stage, median(runs.map(run => run.times[stage]))])),
      medianTotalMs: median(runs.map(run => Object.values(run.times).reduce((a, b) => a + b, 0))),
      medianRetainedHeapMiB: Object.fromEntries(Object.keys(runs[0].retainedHeapMiB).map(stage => [stage, median(runs.map(run => run.retainedHeapMiB[stage]))])),
      runs,
    };
    console.error(`${name}: ${result.variants[name].medianTotalMs.toFixed(1)} ms`);
  }
  console.log(JSON.stringify(result, null, 2));
}
