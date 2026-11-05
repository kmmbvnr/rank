import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const checkout = resolve(process.argv[2] ?? '.');
const variant = process.argv[3] ?? 'keyed';
const diagnostic = process.argv.includes('--diagnostics');
const {Interpreter, RuntimeDiagnostics, parse} = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
const file = variant === 'production' ? 'demos/euler/326_modulosums.ra'
    : `benchmarks/fixtures/v8-euler326-${variant}.ra`;
const source = readFileSync(file, 'utf8');
const program = parse(source.slice(source.indexOf('fun N pairs M')) + '\n1000000000000 pairs 1000000');
const runtime = new Interpreter(() => {});
const stats = diagnostic ? new RuntimeDiagnostics() : undefined;
global.gc();
const start = performance.now();
const answer = stats ? stats.run(() => runtime.executeProgram(program)) : runtime.executeProgram(program);
const milliseconds = performance.now() - start;
assert.equal(answer, 1966666166408794329n);
global.gc();
console.log(JSON.stringify({variant, milliseconds, answer: String(answer), node: process.version,
    peakRssKiB: process.resourceUsage().maxRSS, heapUsed: process.memoryUsage().heapUsed,
    keyedNativeReaders: stats?.keyedNativeReaders, integerKeyedFolds: stats?.integerKeyedFolds}));
runtime.dispose();
