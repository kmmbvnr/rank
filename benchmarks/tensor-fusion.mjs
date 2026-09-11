import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Interpreter, formatValue } from '../packages/interpreter/out/index.js';
import { nodeIo } from '../packages/cli/out/node-io.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const mode = process.argv[2] ?? 'tasks';
const setting = process.argv[3] ?? 'compare';
const backend = process.argv[6] ?? 'tensor';
const counters = process.env.RANK_BENCH_COUNTERS !== '0';
assert(['tensor', 'scalar', 'block', 'loop', 'integer', 'function'].includes(backend));
const answers = new Map();
const samples = Number(process.argv[4] ?? 3);
assert(['tasks', 'suite'].includes(mode));
assert(['on', 'off', 'compare'].includes(setting));
assert(Number.isSafeInteger(samples) && samples > 0);
const hash = value => createHash('sha256').update(value).digest('hex');
const loadModule = (specifier, from) => {
  const id = resolve(from ? dirname(from) : root, specifier.endsWith('.ra') ? specifier : `${specifier}.ra`);
  return { id, source: readFileSync(id, 'utf8') };
};
const files = path => readdirSync(path, { withFileTypes: true }).flatMap(e => {
  const p = resolve(path, e.name);
  return e.isDirectory() ? files(p) : p.endsWith('_test.ra') ? [p] : [];
}).sort();
const array = (items, shape = [items.length]) => ({ kind: 'array', items, shape });
// Independent scalar oracle for the branching compiler fixture.
function recurrenceAnswer(limit) {
  let n = 837799n, total = 0n;
  for (let i = 0; i < limit; i++) {
    n = n === 1n ? 837799n : n % 2n === 0n ? n / 2n : 3n * n + 1n;
    total += n;
  }
  return total;
}
const tasks = [
  { name: 'Stack to index, 200000 entries', path: 'benchmarks/programs/container-loops.ra', fn: 'drain', expected: 200000n * 200001n / 2n, args: () => [200000n] },
  { name: 'Branching recurrence, 200000 steps', path: 'benchmarks/programs/integer-branches.ra', fn: 'recurrence', expected: recurrenceAnswer(200000), args: () => [200000n] },
  { name: 'Euler 28 Size=200001', path: 'demos/euler/028_spiraldiagonals.ra', fn: 'spiral_diagonal_sum', expected: 1n + 16n * 100000n * 100001n * 200001n / 6n + 4n * 100000n * 100001n / 2n + 4n * 100000n, args: () => [200001n] },
  { name: 'Four Squares square_sum helper, 200000 values', path: 'demos/cses/math/026_foursquares.ra', fn: 'square_sum', expected: 199999n * 200000n * 399999n / 6n, args: () => [array(Array.from({length:200000}, (_,i)=>BigInt(i)))] },
  { name: 'Stick Game n=100000 k=100', path: 'demos/cses/math/032_stickgame.ra', input: `100000 100 ${Array.from({length:100}, (_,i)=>i+1).join(' ')}` },
  { name: 'Jacobi 128x128, 10 iterations', path: 'demos/deepml/011_jacobi.ra', fn: 'jacobi', args: () => [array(Array.from({length:128*128}, (_,i)=>i%129===0?2:0), [128,128]), array(Array(128).fill(2)), 10n] },
  { name: 'Linear SVM 32x64, 3 iterations', path: 'demos/deepml/021_svm.ra', fn: 'pegasos', args: () => [array(Array.from({length:32*64}, (_,i)=>(i%17-8)/16), [32,64]), array(Array.from({length:32}, (_,i)=>i%2?1:-1)), 'linear', 0.1, 3n, 1.0] },
  { name: 'Backprop 512x8, 10 epochs', path: 'demos/deepml/025_backprop.ra', fn: 'train_neuron', args: () => [array(Array.from({length:512*8}, (_,i)=>(i%13-6)/16), [512,8]), array(Array.from({length:512}, (_,i)=>i%2)), array(Array(8).fill(0.1)), 0.0, 0.1, 10n] },
  { name: 'Euler 6 Limit=200000', path: 'demos/euler/006_sumsquarediff.ra', cli: ['--limit','200000'] },
  { name: 'Linear equations 40x41', path: 'demos/cses/math/025_linearequations.ra', fn: 'solve_mod', args: () => [40n, 40n, array(Array.from({length:40*41}, (_,i)=>BigInt(i%41===40?1:i%41===Math.floor(i/41)?1:0)), [40,41])] },
];
const paths = mode === 'suite' ? files(resolve(root, 'demos')).map(path => ({path:relative(root,path), name:relative(root,path)})) : tasks;
const selected = process.argv[5] ? paths.filter(item => new RegExp(process.argv[5]).test(item.path)) : paths;
assert(selected.length > 0);
const records = [];
for (let sample=0; sample<samples; sample++) {
 for (const enabled of setting === 'compare' ? (sample % 2 ? [true,false] : [false,true]) : [setting !== 'off']) {
  const start = performance.now();
  const entries = [];
  for (const item of selected) {
    const path = resolve(root,item.path);
    const tokens = item.input?.split(/\s+/) ?? [];
    let offset=0, kernels=0;
    const output=[];
    const runtime = new Interpreter(line => output.push(line), {
      functionBodyCompilation: backend === 'function' ? enabled : undefined,
      onFunctionBodyExecuted: backend === 'function' && counters ? () => kernels++ : undefined,
      tensorFusion: backend === 'tensor' ? enabled : true,
      integerLoopCompilation: backend === 'integer' ? enabled : undefined,
      onIntegerLoopExecuted: backend === 'integer' && counters ? () => kernels++ : undefined,
      loopPreparation: backend === 'loop' ? enabled : undefined,
      blockCompilation: backend === 'block' ? enabled : undefined,
      onBlockExecuted: backend === 'block' && counters ? () => kernels++ : undefined,
      scalarCompilation: backend === 'scalar' ? enabled : undefined,
      onTensorKernelExecuted: backend === 'tensor' && counters ? () => kernels++ : undefined,
      onScalarExecuted: backend === 'scalar' && counters ? () => kernels++ : undefined,
      sourceId:path, loadModule, io:nodeIo, testing: mode === 'suite',
      args: item.cli ?? [], input:{readToken:()=>tokens[offset++]},
    });
    const taskStart = performance.now();
    let digest, tests=0;
    try {
      let value = runtime.execute(item.fn ? `use ${JSON.stringify(path)}` : readFileSync(path,'utf8'));
      if (item.fn) value = runtime.variables.get(item.fn).call(item.args());
      if ('expected' in item) assert.equal(value, item.expected, `independent answer: ${item.name}`);
      if (mode === 'suite') {
        tests=runtime.testResults.length;
        const failures=runtime.testResults.filter(t=>!t.passed);
        assert.deepEqual(failures,[], item.path);
        digest=hash(JSON.stringify(runtime.testResults));
      } else digest=hash(JSON.stringify({output, value:value===undefined?null:formatValue(value)}));
    } finally { runtime.dispose(); }
    const ms=performance.now()-taskStart;
    if (answers.has(item.name)) assert.equal(digest, answers.get(item.name), `changed answer: ${item.name}`);
    else answers.set(item.name, digest);
    entries.push({name:item.name, ms, kernels, tests, digest});
    console.error(`${sample+1} ${enabled?'on':'off'} ${item.name}: ${ms.toFixed(2)}ms, ${kernels} kernels`);
  }
  records.push({enabled, sample, ms:performance.now()-start, entries});
 }
}
console.log(JSON.stringify({node:process.version, mode, setting, backend, counters, samples, timing:"fresh interpreters; includes parsing, loading, compilation, evaluation and result validation; alternating mode order", records},null,2));
