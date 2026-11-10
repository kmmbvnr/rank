import { pathToFileURL } from 'node:url';
const [root, name, count = '2000'] = process.argv.slice(2);
if (!root || !['named', 'ranked', 'callable', 'capture'].includes(name) || !/^\d+$/.test(count)) {
  throw new Error('Usage: node benchmarks/function-composition.mjs ROOT named|ranked|callable|capture [COUNT]');
}
const { Interpreter, formatValue } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const definitions = {
  named: 'fun X square\n return X * X\nend\nfun X helper\n return (X square) + 1\nend\n',
  ranked: 'fun X square rank 0\n return X * X\nend\nfun X helper\n return (X square) + 1\nend\n',
  callable: 'fun X square\n return X * X\nend\nfun X helper op\n return (X op) + 1\nend\n',
  capture: 'fun X apply op\n return (X op) + 1\nend\nfun Offset helper\n fun X shifted\n  return X + Offset\n end\n return 3 apply shifted\nend\n',
};
const call = name === 'callable' ? 'I helper square' : 'I helper';
const source = `${definitions[name]}Total = 0\nfor I in 1 to ${count}\n Total += ${call}\nend\nTotal`;
function run() {
  const runtime = new Interpreter();
  try { return formatValue(runtime.execute(source)); }
  finally { runtime.dispose(); }
}
const start = performance.now(), result = run(), cold = performance.now() - start;
const samples = [];
for (let i = 0; i < 5; i++) { const start = performance.now(); if (run() !== result) throw new Error('unstable result'); samples.push(performance.now() - start); }
console.log(JSON.stringify({ name, count: Number(count), result, cold, median: samples.sort((a,b)=>a-b)[2], rssKiB: process.resourceUsage().maxRSS, node: process.version }));
