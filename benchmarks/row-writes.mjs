import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

// Whole-row, partial-row, column and plane writes into rank-2/3 integer
// arrays against the flat slice write of the same length (issue #476).
// Usage: node benchmarks/row-writes.mjs [--baseline=PATH] [--samples=N]
const root = fileURLToPath(new URL('..', import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
    const match = /^--(baseline|samples)=(.+)$/.exec(arg);
    if (!match) throw Error(`Unknown option: ${arg}`);
    return [match[1], match[2]];
}));
const samples = Number(options.samples ?? 5);
assert(Number.isSafeInteger(samples) && samples >= 3);

const prelude = `use numbers
use sequences
use io
Zl = 1000000
Fl = (0 to (Zl - 1)) * 0 + 3
`;
const loop = (setup, body, result) => `${prelude}${setup}
T = 0
for J in 1 to 20
  ${body}
  T += ${result}
end
T print
`;
const cases = {
    'row write (rank 2)': [loop('Dp = array shape 2 Zl fill 1', 'Dp 1 = Fl', 'Dp 1 5'), '60'],
    'flat slice write (control)': [loop('Dp = array shape 2000000 fill 1\nLo = Zl', 'Dp (Lo till Lo + Zl) = Fl', 'Dp Zl + 5'), '60'],
    'row copy (Dp 1 = Dp 0)': [loop('Dp = array shape 2 Zl fill 1', 'Dp 1 = Dp 0', 'Dp 1 5'), '20'],
    'partial row write': [loop('Dp = array shape 2 Zl fill 1\nHalf = 500000\nHs = (0 to (Half - 1)) * 0 + 3', 'Dp 1 (0 till Half) = Hs', 'Dp 1 5'), '60'],
    'row write (rank 3 plane)': [loop('Dp = array shape 2 2 500000 fill 1\nPl = array shape 2 500000 fill 3', 'Dp 1 = Pl', 'Dp 1 1 5'), '60'],
};
const checkouts = { candidate: root, ...(options.baseline ? { baseline: resolve(options.baseline) } : {}) };
const interpreters = {};
for (const [name, checkout] of Object.entries(checkouts)) {
    const { Interpreter } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
    interpreters[name] = Interpreter;
}
const run = (name, source) => {
    const lines = [];
    const interpreter = new interpreters[name](text => lines.push(String(text)));
    const start = performance.now();
    interpreter.execute(source);
    const elapsed = performance.now() - start;
    interpreter.dispose();
    return { elapsed, output: lines.join('\n') };
};
const results = {};
for (let iteration = 0; iteration < samples + 1; iteration++) {
    const names = Object.keys(checkouts);
    if (iteration % 2) names.reverse();
    for (const [label, [source, expected]] of Object.entries(cases)) for (const name of names) {
        const { elapsed, output } = run(name, source);
        assert(output.includes(expected), `${label} (${name}): expected ${expected}, got ${output}`);
        if (iteration > 0) ((results[name] ??= {})[label] ??= []).push(elapsed);
    }
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const revision = checkout => execFileSync('git', ['-C', checkout, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
console.log(`node ${process.version}, ${cpus()[0]?.model}, ${samples} samples (median ms, 20 iterations over 10^6 cells)`);
for (const [name, checkout] of Object.entries(checkouts)) console.log(`${name}: ${revision(checkout)}`);
const control = median(results.candidate['flat slice write (control)']);
for (const label of Object.keys(cases)) {
    const cells = Object.keys(checkouts).map(name => `${name} ${median(results[name][label]).toFixed(0)} ms`);
    const ratio = median(results.candidate[label]) / control;
    console.log(`${label.padEnd(28)} ${cells.join('  ')}  (candidate/flat ${ratio.toFixed(2)}x)`);
}
