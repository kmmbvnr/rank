// Build first: npx tsc -b tsconfig.build.json
// Each sample uses a fresh process; parsing, construction and five loop passes
// are included. Checksums are independent of the interpreter's array readers.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Interpreter } from '../packages/interpreter/out/index.js';
const { values } = parseArgs({ options: {
  case: { type: 'string' }, samples: { type: 'string', default: '3' },
  rows: { type: 'string', default: '500' }, columns: { type: 'string', default: '9996' },
} });
const rows = Number(values.rows), columns = Number(values.columns);
assert(Number.isSafeInteger(rows) && rows > 0 && Number.isSafeInteger(columns) && columns >= 8);
const size = rows * columns, kept = Math.floor(columns * 9000 / 9996), selected = rows * kept;
const cases = {
  fill: [`D = array shape ${size} fill 1`, 'D * 3 mod 7', BigInt(size) * 15n],
  'fill-copy': [`D = array shape ${size} fill 1\nD = D copy`, 'D * 3 mod 7', BigInt(size) * 15n],
  computed: [`D = (0 till ${size}) * 0 + 1`, 'D * 3 mod 7', BigInt(size) * 15n],
  'slice-vector': [`D = (0 till ${size}) * 0 + 1`, `D (0 till ${selected})`, BigInt(selected) * 5n],
  'slice-matrix': [`D = array shape ${rows} ${columns} fill 1`, `D (0 till ${rows}) (0 till ${kept})`, BigInt(selected) * 5n],
  concat: [`D = array shape ${rows} ${columns} fill 1\nZ = array shape ${rows} 4 fill 0`, 'concat D Z axis 1', BigInt(size) * 5n],
};
if (values.case) {
  assert(Object.hasOwn(cases, values.case));
  const [init, expression, expected] = cases[values.case];
  const output = [];
  const runtime = new Interpreter(value => output.push(value));
  try {
    const start = performance.now();
    runtime.execute(`use sequences\nuse io\n${init}\nX = 0\nfor I in 1 to 5\n Y = ${expression}\n X += Y sum\nend\nX print`);
    const ms = performance.now() - start;
    assert.deepEqual(output, [String(expected)]);
    console.log(JSON.stringify({ name: values.case, ms, checksum: String(expected), rssMiB: process.memoryUsage().rss / 1048576 }));
  } finally { runtime.dispose(); }
} else {
  const samples = Number(values.samples);
  assert(Number.isSafeInteger(samples) && samples > 0);
  console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, rows, columns, samples }));
  for (const name of Object.keys(cases)) {
    const results = [];
    for (let sample = 0; sample < samples; sample++) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--case=${name}`, `--rows=${rows}`, `--columns=${columns}`], { encoding: 'utf8' });
      assert.equal(child.status, 0, child.stderr || child.stdout);
      results.push(JSON.parse(child.stdout));
    }
    const times = results.map(result => result.ms).sort((a, b) => a - b);
    console.log(JSON.stringify({ name, medianMs: times[Math.floor(times.length / 2)], results }));
  }
}
