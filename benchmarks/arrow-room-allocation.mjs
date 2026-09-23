import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { tableFromArrays } from 'apache-arrow';
import { Interpreter } from '../packages/interpreter/out/index.js';
import { ownedArray } from '../packages/interpreter/out/array-storage.js';

const program = `use algo\nuse sequences\nfun allocate_rooms Data${readFileSync('demos/cses/sortnsrch/022_rooms.ra', 'utf8').split('fun allocate_rooms Data')[1]}`;
const sizes = [1024, 20000, 100000];
const samples = 5;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const bytes = () => { const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; };

class MinHeap {
  items = [];
  get length() { return this.items.length; }
  push(priority, value) {
    const a = this.items;
    let i = a.length;
    a.push({ priority, value });
    while (i > 0) {
      const p = i - 1 >> 1;
      if (a[p].priority <= priority) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = { priority, value };
  }
  peek() { return this.items[0]; }
  pop() {
    const a = this.items;
    const first = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (2 * i + 1 < a.length) {
        let child = 2 * i + 1;
        if (child + 1 < a.length && a[child + 1].priority < a[child].priority) child++;
        if (a[child].priority >= last.priority) break;
        a[i] = a[child];
        i = child;
      }
      a[i] = last;
    }
    return first.value;
  }
}

function allocate(size, start, finish) {
  const order = Array.from({ length: size }, (_, i) => i);
  order.sort((a, b) => start(a) - start(b));
  const free = new MinHeap(), busy = new MinHeap();
  const rooms = new Uint32Array(size);
  let count = 0;
  for (const i of order) {
    while (busy.length && busy.peek().priority < start(i)) {
      const room = busy.pop();
      free.push(room, room);
    }
    const room = free.length ? free.pop() : ++count;
    rooms[i] = room;
    busy.push(finish(i), room);
  }
  return { count, rooms };
}

function input(size) {
  const start = Array.from({ length: size }, (_, i) => (i * 73) % size + 1);
  const finish = Array.from({ length: size }, (_, i) => start[i] + 1 + (i * 17) % 50);
  return { start, finish };
}

if (process.argv[2] === '--worker') {
  assert(global.gc, 'run with --expose-gc');
  const mode = process.argv[3], size = Number(process.argv[4]);
  assert(['matrix', 'typed', 'arrow', 'rank'].includes(mode) && sizes.includes(size));
  let runtime, setupMs = 0;
  if (mode === 'rank') {
    runtime = new Interpreter(() => {});
    const now = performance.now();
    runtime.execute(program);
    setupMs = performance.now() - now;
  }
  global.gc();
  const before = bytes();
  let data = input(size);
  const buildStart = performance.now();
  let cells = mode === 'arrow' ? null : Array.from({ length: size * 2 }, (_, k) =>
    k % 2 ? data.finish[k >> 1] : data.start[k >> 1]);
  const table = mode === 'arrow' ? tableFromArrays(data)
    : mode === 'typed' ? Float64Array.from(cells) : ownedArray(cells, [size, 2], true);
  const buildMs = performance.now() - buildStart;
  cells = null;
  data = null;
  global.gc();
  const retainedMiB = mode === 'rank' ? null : (bytes() - before) / 1048576;
  const starts = mode === 'arrow' ? table.getChild('start') : null;
  const finishes = mode === 'arrow' ? table.getChild('finish') : null;
  const start = mode === 'arrow' ? i => starts.get(i)
    : mode === 'typed' ? i => table[i * 2] : i => table.items[i * 2];
  const finish = mode === 'arrow' ? i => finishes.get(i)
    : mode === 'typed' ? i => table[i * 2 + 1] : i => table.items[i * 2 + 1];
  const queryStart = performance.now();
  let actual;
  if (mode === 'rank') {
    const result = runtime.variables.get('allocate_rooms').call([table]);
    actual = { count: Number(result.entries.get('count')),
      rooms: result.entries.get('rooms').items.map(Number) };
  } else actual = allocate(size, start, finish);
  const queryMs = performance.now() - queryStart;
  const oracle = input(size);
  const expected = allocate(size, i => oracle.start[i], i => oracle.finish[i]);
  assert.equal(actual.count, expected.count);
  assert.deepEqual(Array.from(actual.rooms), Array.from(expected.rooms));
  runtime?.dispose();
  console.log(JSON.stringify({ mode, size, buildMs, setupMs, queryMs, retainedMiB, count: actual.count }));
} else {
  const report = { node: process.version, cpu: cpus()[0]?.model, arrow: '21.2.0',
    source: 'demos/cses/sortnsrch/022_rooms.ra; deterministic in-memory intervals', samples,
    method: 'fresh process per run; matrix/typed/arrow use the same JS heap algorithm; rank invokes the original function; input and oracle excluded; memory is post-GC heapUsed + arrayBuffers delta, not peak',
    results: [] };
  for (const size of sizes) {
    const runs = { matrix: [], typed: [], arrow: [], rank: [] };
    for (let sample = 0; sample < samples; sample++) {
      for (const mode of sample % 2 ? ['rank', 'arrow', 'typed', 'matrix'] : ['matrix', 'typed', 'arrow', 'rank']) {
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
        retainedMiB: mode === 'rank' ? null : median(values.map(x => x.retainedMiB)), count: values[0].count,
        samples: values });
    }
  }
  console.log(JSON.stringify(report, null, 2));
}
