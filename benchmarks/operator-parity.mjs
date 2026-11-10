import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const [root, name, count = '10000'] = process.argv.slice(2);
if (!root || !name || !Number.isSafeInteger(Number(count)) || Number(count) < 1) {
  throw new Error('Usage: node benchmarks/operator-parity.mjs ROOT CASE [ITERATIONS]');
}
const { Interpreter, formatValue } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const sources = {
  mixed: 'Total = 0.0\nfor I in 1 to 10000\n Total += (I / 3.0) + 1.0\nend\nTotal',
  integer: 'Total = 0\nfor I in 1 to 10000\n Total += I * 3 + 1\nend\nTotal',
  tensor: 'use sequences\nLeft = array 1 to 200000\nRight = (Left + 0.0) copy\nResult = (Left + 0) equal Right\nResult len',
};
const source = sources[name]?.replace('1 to 10000', `1 to ${count}`) ?? readFileSync(`${root}/demos/euler/${name}.ra`, 'utf8');
const options = name === 'mixed' || name === 'integer' ? {
  scalarEntryCompilation: false, scalarFunctionCompilation: false, integerLoopCompilation: false, tensorFusion: false,
} : {};
function run() {
  const runtime = new Interpreter(() => {}, options);
  try { return formatValue(runtime.execute(source)); }
  finally { runtime.dispose(); }
}
const start = performance.now();
const result = run();
const cold = performance.now() - start;
const samples = [];
for (let i = 0; i < 5; i++) { const start = performance.now(); run(); samples.push(performance.now() - start); }
console.log(JSON.stringify({ name, result, cold, median: samples.sort((a,b)=>a-b)[2], rssKiB: process.resourceUsage().maxRSS, node: process.version }));
