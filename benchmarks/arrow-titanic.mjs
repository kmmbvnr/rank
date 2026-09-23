import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { tableFromArrays } from 'apache-arrow';
import { ownedArray, ownedObject } from '../packages/interpreter/out/array-storage.js';

// The four columns and operations come from demos/kaggle/001_titanic.ra's
// prepare_features: median fill, a derived Female column, and a numeric matrix.
const sizes = [1_000, 100_000];
const samples = 5;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const bytes = () => {
  const usage = process.memoryUsage();
  return usage.heapUsed + usage.arrayBuffers;
};

function input(size) {
  return {
    Sex: Array.from({ length: size }, (_, i) => i % 3 ? 'male' : 'female'),
    Pclass: Array.from({ length: size }, (_, i) => i % 3 + 1),
    Age: Array.from({ length: size }, (_, i) => i % 11 ? 18 + i % 63 : null),
    Fare: Array.from({ length: size }, (_, i) => i % 13 ? 5 + i % 200 / 4 : null),
  };
}

function middle(values) {
  values.sort((a, b) => a - b);
  const half = Math.floor(values.length / 2);
  return values.length % 2 ? values[half] : (values[half - 1] + values[half]) / 2;
}

function rowTable(source, size) {
  const rows = Array.from({ length: size }, (_, i) => {
    const entries = new Map();
    for (const name of Object.keys(source)) {
      if (source[name][i] !== null) entries.set(name, source[name][i]);
    }
    return ownedObject(entries);
  });
  return ownedArray(rows, [size], false, Object.keys(source));
}

function prepareRows(table) {
  const rows = table.items;
  const ages = [], fares = [];
  for (const row of rows) {
    if (row.entries.has('Age')) ages.push(row.entries.get('Age'));
    if (row.entries.has('Fare')) fares.push(row.entries.get('Fare'));
  }
  const age = middle(ages), fare = middle(fares);
  const matrix = new Float64Array(rows.length * 4);
  let checksum = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].entries;
    row.set('Age', row.get('Age') ?? age);
    row.set('Fare', row.get('Fare') ?? fare);
    row.set('Female', Number(row.get('Sex') === 'female'));
    for (const [column, name] of ['Female', 'Pclass', 'Age', 'Fare'].entries()) {
      const value = row.get(name);
      matrix[i * 4 + column] = value;
      checksum += value * (column + 1);
    }
  }
  return { matrix, checksum };
}

function prepareArrow(table) {
  const sex = table.getChild('Sex');
  const pclass = table.getChild('Pclass');
  const ages = table.getChild('Age');
  const fares = table.getChild('Fare');
  const ageValues = [], fareValues = [];
  for (let i = 0; i < table.numRows; i++) {
    const age = ages.get(i), fare = fares.get(i);
    if (age !== null) ageValues.push(age);
    if (fare !== null) fareValues.push(fare);
  }
  const ageFill = middle(ageValues), fareFill = middle(fareValues);
  const female = new Uint8Array(table.numRows);
  const matrix = new Float64Array(table.numRows * 4);
  let checksum = 0;
  for (let i = 0; i < table.numRows; i++) {
    if (ages.get(i) === null) ages.set(i, ageFill);
    if (fares.get(i) === null) fares.set(i, fareFill);
    female[i] = Number(sex.get(i) === 'female');
    const values = [female[i], pclass.get(i), ages.get(i), fares.get(i)];
    for (let column = 0; column < 4; column++) {
      matrix[i * 4 + column] = values[column];
      checksum += values[column] * (column + 1);
    }
  }
  const withFemale = table.assign(tableFromArrays({ Female: female }));
  assert.equal(withFemale.getChild('Female').get(0), female[0]);
  return { matrix, checksum, table: withFemale };
}

function scanFare(mode, table) {
  let total = 0;
  if (mode === 'rows') {
    for (const row of table.items) total += row.entries.get('Fare');
  } else {
    const fares = table.getChild('Fare');
    for (let i = 0; i < table.numRows; i++) total += fares.get(i);
  }
  return total;
}

if (process.argv[2] === '--worker') {
  assert(global.gc, 'run with --expose-gc');
  const mode = process.argv[3], size = Number(process.argv[4]);
  assert(['rows', 'arrow'].includes(mode));
  global.gc();
  const before = bytes();
  let source = input(size);
  const buildStart = performance.now();
  const table = mode === 'rows' ? rowTable(source, size) : tableFromArrays(source);
  const buildMs = performance.now() - buildStart;
  source = null;
  global.gc();
  const retainedBytes = bytes() - before;
  const prepareStart = performance.now();
  const result = mode === 'rows' ? prepareRows(table) : prepareArrow(table);
  const prepareMs = performance.now() - prepareStart;
  const scanStart = performance.now();
  const fareTotal = scanFare(mode, result.table ?? table);
  const scanMs = performance.now() - scanStart;
  global.gc();
  const preparedBytes = bytes() - before;
  console.log(JSON.stringify({ mode, size, buildMs, prepareMs, scanMs, fareTotal, retainedBytes,
    preparedBytes, checksum: result.checksum, matrixLength: result.matrix.length,
    matrixHash: createHash('sha256').update(new Uint8Array(result.matrix.buffer)).digest('hex') }));
} else {
  const report = { node: process.version, cpu: cpus()[0]?.model, arrow: '21.2.0',
    samples, memory: 'post-GC heapUsed + arrayBuffers delta from before input generation; source variable released before measurement; not peak memory',
    timing: 'build from identical JS columns; median/fill/derive/matrix, then one Fare scan; Rank-owned row storage versus Arrow table, preparation in JS rather than Rank language',
    results: [] };
  for (const size of sizes) {
    const runs = { rows: [], arrow: [] };
    for (let sample = 0; sample < samples; sample++) {
      for (const mode of sample % 2 ? ['arrow', 'rows'] : ['rows', 'arrow']) {
        const child = spawnSync(process.execPath, ['--expose-gc', new URL(import.meta.url).pathname,
          '--worker', mode, String(size)], { encoding: 'utf8', timeout: 120_000 });
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stderr);
        runs[mode].push(JSON.parse(child.stdout));
      }
    }
    for (let sample = 0; sample < samples; sample++) {
      assert.equal(runs.rows[sample].checksum, runs.arrow[sample].checksum);
      assert.equal(runs.rows[sample].matrixLength, runs.arrow[sample].matrixLength);
      assert.equal(runs.rows[sample].matrixHash, runs.arrow[sample].matrixHash);
      assert.equal(runs.rows[sample].fareTotal, runs.arrow[sample].fareTotal);
    }
    for (const mode of ['rows', 'arrow']) {
      const data = runs[mode];
      report.results.push({ mode, size, buildMs: median(data.map(x => x.buildMs)),
        prepareMs: median(data.map(x => x.prepareMs)),
        scanMs: median(data.map(x => x.scanMs)),
        retainedMiB: median(data.map(x => x.retainedBytes)) / 1048576,
        preparedMiB: median(data.map(x => x.preparedBytes)) / 1048576,
        checksum: data[0].checksum, samples: data });
    }
  }
  console.log(JSON.stringify(report, null, 2));
}
