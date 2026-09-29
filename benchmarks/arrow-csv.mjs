import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { parseCsv } from '../packages/interpreter/out/modules/tables.js';
import { parseCsvToArrow } from '../packages/interpreter/out/arrow-table.js';

// CSV text -> table, the step Rank's `csv` does. Row objects (today) against
// Arrow columns, each in its own process so memory is not shared between runs.
// Input is a Titanic-shaped synthetic file (size rows) or a path to a real CSV.
const sizes = [1_000, 100_000];
const samples = Number(process.env.SAMPLES ?? 5);
const bytes = () => {
  const usage = process.memoryUsage();
  return usage.heapUsed + usage.arrayBuffers;
};

function synthetic(size) {
  const lines = ['PassengerId,Survived,Pclass,Name,Sex,Age,SibSp,Parch,Ticket,Fare,Cabin,Embarked'];
  for (let i = 0; i < size; i++) {
    lines.push([
      i + 1, i % 3 === 0 ? 1 : 0, i % 3 + 1, `"Person, Number ${i}"`, i % 3 ? 'male' : 'female',
      i % 11 ? 18 + i % 63 : '', i % 4, i % 3, `T${i % 700}`, i % 13 ? (5 + i % 200 / 4).toFixed(4) : '',
      i % 5 ? '' : `C${i % 90}`, 'SCQ'[i % 3],
    ].join(','));
  }
  return lines.join('\n') + '\n';
}

function scan(table, mode, column) {
  let total = 0;
  if (mode === 'rows') {
    for (const row of table.items) total += Number(row.entries.get(column) ?? 0);
  } else {
    const index = table.names.indexOf(column);
    for (let i = 0; i < table.length; i++) total += Number(table.cell(i, index) ?? 0);
  }
  return total;
}

if (process.argv[2] === '--worker') {
  assert(global.gc, 'run with --expose-gc');
  const [mode, source, column] = process.argv.slice(3);
  // Retained memory is measured against a baseline taken before the text exists,
  // so the released text is not credited to the table.
  global.gc();
  const before = bytes();
  let text = /^\d+$/.test(source) ? synthetic(Number(source)) : readFileSync(source, 'utf8');
  global.gc();
  const baseRss = process.resourceUsage().maxRSS;
  let table, buildMs = 0;
  if (mode !== 'none') {
    const start = performance.now();
    table = mode === 'rows' ? parseCsv(text) : parseCsvToArrow(text);
    buildMs = performance.now() - start;
  }
  const rssPeak = process.resourceUsage().maxRSS;
  const textBytes = Buffer.byteLength(text);
  text = null;
  global.gc();
  const retainedBytes = bytes() - before;
  const scanStart = performance.now();
  const total = table === undefined ? 0 : scan(table, mode, column);
  const scanMs = performance.now() - scanStart;
  const rows = table === undefined ? 0 : (mode === 'rows' ? table.items.length : table.length);
  console.log(JSON.stringify({ mode, source, rows, textBytes, buildMs, scanMs, total, retainedBytes,
    peakRssGrowthKiB: rssPeak - baseRss }));
} else {
  const inputs = process.argv.slice(2).map(item => item.split(':'));
  if (inputs.length === 0) for (const size of sizes) inputs.push([String(size), 'Fare']);
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const report = { node: process.version, cpu: cpus()[0]?.model, samples,
    memory: 'retained = post-GC heapUsed + arrayBuffers delta after the CSV text is released; peakRssGrowth = maxRSS growth while building (process high-water mark, KiB)',
    results: [] };
  for (const [source, column] of inputs) {
    const runs = { rows: [], arrow: [] };
    for (let i = 0; i < samples; i++) {
      for (const mode of ['rows', 'arrow']) {
        const result = spawnSync(process.execPath, ['--expose-gc', `--max-old-space-size=${process.env.HEAP_MB ?? 4096}`, new URL(import.meta.url).pathname,
          '--worker', mode, source, column ?? 'Fare'], { encoding: 'utf8' });
        if (result.status !== 0) {
          runs[mode].failed = (result.stderr.split('\n').find(line => /Error|heap/.test(line)) ?? `exit ${result.status}`).slice(0, 120);
          break;
        }
        runs[mode].push(JSON.parse(result.stdout));
      }
    }
    if (runs.rows.failed || runs.arrow.failed) {
      report.results.push({ source, rowsFailed: runs.rows.failed, arrowFailed: runs.arrow.failed,
        arrow: runs.arrow[0] });
      continue;
    }
    const pick = (mode, key) => median(runs[mode].map(run => run[key]));
    assert.equal(runs.rows[0].total, runs.arrow[0].total, 'column sums differ');
    assert.equal(runs.rows[0].rows, runs.arrow[0].rows, 'row counts differ');
    const row = { source, rows: runs.rows[0].rows, textMiB: runs.rows[0].textBytes / 1048576 };
    for (const key of ['buildMs', 'scanMs', 'retainedBytes', 'peakRssGrowthKiB']) {
      row[key] = { rows: pick('rows', key), arrow: pick('arrow', key), ratio: pick('rows', key) / pick('arrow', key) };
    }
    report.results.push(row);
  }
  console.log(JSON.stringify(report, null, 2));
}
