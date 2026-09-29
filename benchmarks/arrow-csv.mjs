import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { parseCsvToArrow } from '../packages/interpreter/out/arrow-table.js';

// CSV text -> column table, the step Rank's `csv` does. Each sample runs in its
// own process so memory is not shared between runs. Input is a Titanic-shaped
// synthetic file (size rows) or a path to a real CSV.
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

function scan(table, column) {
  let total = 0;
  const index = table.names.indexOf(column);
  for (let i = 0; i < table.length; i++) total += Number(table.cell(i, index) ?? 0);
  return total;
}

if (process.argv[2] === '--worker') {
  assert(global.gc, 'run with --expose-gc');
  const [source, column] = process.argv.slice(3);
  // Retained memory is measured against a baseline taken before the text exists,
  // so the released text is not credited to the table.
  global.gc();
  const before = bytes();
  let text = /^\d+$/.test(source) ? synthetic(Number(source)) : readFileSync(source, 'utf8');
  global.gc();
  const baseRss = process.resourceUsage().maxRSS;
  const start = performance.now();
  const table = parseCsvToArrow(text);
  const buildMs = performance.now() - start;
  const rssPeak = process.resourceUsage().maxRSS;
  const textBytes = Buffer.byteLength(text);
  text = null;
  global.gc();
  const retainedBytes = bytes() - before;
  const scanStart = performance.now();
  const total = scan(table, column);
  const scanMs = performance.now() - scanStart;
  console.log(JSON.stringify({ source, rows: table.length, textBytes, buildMs, scanMs, total, retainedBytes,
    peakRssGrowthKiB: rssPeak - baseRss }));
} else {
  const inputs = process.argv.slice(2).map(item => item.split(':'));
  if (inputs.length === 0) for (const size of sizes) inputs.push([String(size), 'Fare']);
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const report = { node: process.version, cpu: cpus()[0]?.model, samples,
    memory: 'retained = post-GC heapUsed + arrayBuffers delta after the CSV text is released; peakRssGrowth = maxRSS growth while building (process high-water mark, KiB)',
    results: [] };
  for (const [source, column] of inputs) {
    const runs = [];
    let failed;
    for (let i = 0; i < samples; i++) {
      const result = spawnSync(process.execPath, ['--expose-gc', `--max-old-space-size=${process.env.HEAP_MB ?? 4096}`, new URL(import.meta.url).pathname,
        '--worker', source, column ?? 'Fare'], { encoding: 'utf8' });
      if (result.status !== 0) {
        failed = (result.stderr.split('\n').find(line => /Error|heap/.test(line)) ?? `exit ${result.status}`).slice(0, 120);
        break;
      }
      runs.push(JSON.parse(result.stdout));
    }
    if (failed) { report.results.push({ source, failed }); continue; }
    const pick = key => median(runs.map(run => run[key]));
    report.results.push({ source, rows: runs[0].rows, textMiB: runs[0].textBytes / 1048576,
      buildMs: pick('buildMs'), scanMs: pick('scanMs'), retainedBytes: pick('retainedBytes'),
      peakRssGrowthKiB: pick('peakRssGrowthKiB') });
  }
  console.log(JSON.stringify(report, null, 2));
}
