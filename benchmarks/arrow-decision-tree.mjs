import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { tableFromArrays } from 'apache-arrow';
import { Interpreter } from '../packages/interpreter/out/index.js';
import { ownedArray, ownedObject } from '../packages/interpreter/out/array-storage.js';
import { indexKey } from '../packages/interpreter/out/index-key.js';

const source = readFileSync('demos/deepml/020_tree.ra', 'utf8');
const names = ['A', 'B', 'C', 'Class'];
const attrs = names.slice(0, -1);
const sizes = [1024, 8192, 32768];
const samples = 5;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const bytes = () => {
  const m = process.memoryUsage();
  return m.heapUsed + m.arrayBuffers;
};

function columns(size) {
  const result = Object.fromEntries(names.map(name => [name, []]));
  for (let i = 0; i < size; i++) {
    const a = i & 1, b = i >> 1 & 1, c = i >> 2 & 1;
    result.A.push(`A${a}`);
    result.B.push(`B${b}`);
    result.C.push(`C${c}`);
    result.Class.push((a === 0 ? b : c) === 0 ? 'No' : 'Yes');
  }
  return result;
}

function rowTable(data) {
  const count = data.A.length;
  return ownedArray(Array.from({ length: count }, (_, i) =>
    ownedObject(names.map(name => [name, data[name][i]]))), [count], false, names);
}

function entropy(ids, get) {
  const counts = new Map();
  for (const i of ids) {
    const value = get(i, 'Class');
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let result = 0;
  for (const count of counts.values()) {
    const p = count / ids.length;
    result -= p * Math.log2(p);
  }
  return result;
}

function learn(ids, remaining, get) {
  const classes = [...new Set(ids.map(i => get(i, 'Class')))];
  if (classes.length === 1) return classes[0];
  if (remaining.length === 0) {
    const counts = new Map(classes.map(value => [value, 0]));
    for (const i of ids) counts.set(get(i, 'Class'), counts.get(get(i, 'Class')) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  }
  const base = entropy(ids, get);
  let best = remaining[0], bestGain = -1;
  for (const attr of remaining) {
    const groups = new Map();
    for (const i of ids) {
      const value = get(i, attr);
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(i);
    }
    let gain = base;
    for (const part of groups.values()) gain -= part.length / ids.length * entropy(part, get);
    if (gain > bestGain) { best = attr; bestGain = gain; }
  }
  const groups = new Map();
  for (const i of ids) {
    const value = get(i, best);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(i);
  }
  const branches = new Map();
  for (const value of [...groups.keys()].sort()) {
    branches.set(indexKey([value]), learn(groups.get(value), remaining.filter(x => x !== best), get));
  }
  return { kind: 'index', entries: new Map([[indexKey([best]), { kind: 'index', entries: branches }]]) };
}

function signature(tree) {
  if (typeof tree === 'string') return tree;
  assert.equal(tree.kind, 'index');
  return [...tree.entries].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, signature(value)]);
}

if (process.argv[2] === '--worker') {
  assert(global.gc, 'run with --expose-gc');
  const mode = process.argv[3], size = Number(process.argv[4]);
  assert(['rows', 'arrow', 'rank'].includes(mode) && sizes.includes(size));
  const ids = Array.from({ length: size }, (_, i) => i);
  let runtime, setupMs = 0;
  if (mode === 'rank') {
    runtime = new Interpreter(() => {});
    const start = performance.now();
    runtime.execute(source);
    setupMs = performance.now() - start;
  }
  global.gc();
  const before = bytes();
  let data = columns(size);
  const expected = JSON.stringify(signature(learn(ids, attrs, (i, name) => data[name][i])));
  const buildStart = performance.now();
  const table = mode === 'arrow' ? tableFromArrays(data) : rowTable(data);
  const buildMs = performance.now() - buildStart;
  data = null;
  global.gc();
  const retainedMiB = (bytes() - before) / 1048576;
  const child = mode === 'arrow' ? new Map(attrs.concat('Class').map(name => [name, table.getChild(name)])) : null;
  const get = mode === 'arrow' ? (i, name) => child.get(name).get(i)
    : (i, name) => table.items[i].entries.get(name);
  const queryStart = performance.now();
  const tree = mode === 'rank'
    ? runtime.variables.get('learn_tree').call([table, ownedArray(attrs), 'Class'])
    : learn(ids, attrs, get);
  const queryMs = performance.now() - queryStart;
  const actual = JSON.stringify(signature(tree));
  assert.equal(actual, expected, `${mode}: tree differs`);
  runtime?.dispose();
  console.log(JSON.stringify({ mode, size, buildMs, setupMs, queryMs, retainedMiB, signature: actual }));
} else {
  const report = { node: process.version, cpu: cpus()[0]?.model, arrow: '21.2.0',
    source: 'demos/deepml/020_tree.ra; deterministic in-memory categorical data', samples,
    method: 'fresh process per run; rows/arrow use the same JS tree learner; rank invokes the actual Rank function; source generation and oracle excluded; memory is post-GC heapUsed + arrayBuffers delta after build, not peak',
    results: [] };
  for (const size of sizes) {
    const runs = { rows: [], arrow: [], rank: [] };
    for (let sample = 0; sample < samples; sample++) {
      for (const mode of sample % 2 ? ['rank', 'arrow', 'rows'] : ['rows', 'arrow', 'rank']) {
        const result = spawnSync(process.execPath,
          ['--expose-gc', new URL(import.meta.url).pathname, '--worker', mode, String(size)],
          { encoding: 'utf8', timeout: 120_000 });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        runs[mode].push(JSON.parse(result.stdout));
      }
    }
    for (const [mode, values] of Object.entries(runs)) {
      report.results.push({ mode, size, buildMs: median(values.map(x => x.buildMs)),
        setupMs: median(values.map(x => x.setupMs)), queryMs: median(values.map(x => x.queryMs)),
        retainedMiB: median(values.map(x => x.retainedMiB)), samples: values });
    }
  }
  console.log(JSON.stringify(report, null, 2));
}
