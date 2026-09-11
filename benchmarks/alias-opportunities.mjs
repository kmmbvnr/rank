import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { parse } from '../packages/interpreter/out/index.js';
import { analyzeFunction, children } from './experiments/alias-analysis.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function files(directory) {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(path) : path.endsWith('.ra') && !path.endsWith('_test.ra') ? [path] : [];
  });
}
const results = [];
const parseFailures = [];
let analysisMs = 0;
let count = 0;
for (const path of files('demos').sort()) {
  let program;
  try { program = parse(readFileSync(resolve(root, path), 'utf8'), path); }
  catch (error) { parseFailures.push({ path, message: error.message }); continue; }
  function visit(node) {
    if (node.$type === 'FunctionStatement') {
      const start = performance.now();
      const facts = analyzeFunction(node);
      analysisMs += performance.now() - start;
      count++;
      const arrays = facts.filter(item => item.freshArray);
      if (arrays.length) results.push({ path, function: node.name, arrays });
    }
    for (const child of children(node)) visit(child);
  }
  visit(program);
}
console.log(JSON.stringify({ note: 'Offline conservative opportunity scan, not an optimization or a proof of numeric/pure storage. Unknown applications include selectors without runtime type contracts.',
  functions: count, analysisMs, parseFailures, results }, null, 2));
