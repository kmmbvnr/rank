// Build first. Run one process at a time; use --source=/path/to/frozen.ra
// to compare demo changes on the same runtime. --count=0 skips the search.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { AstUtils } from 'langium';
import { isAssignmentStatement, isNameExpression } from '../packages/language/out/index.js';
import { Interpreter, parse } from '../packages/interpreter/out/index.js';
import { nameFactsIn } from '../packages/common/out/name-facts.js';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const file = option('source') ?? fileURLToPath(new URL('../demos/euler/263_engineersdream.ra', import.meta.url));
const count = Number(option('count') ?? 4);
assert.ok(Number.isSafeInteger(count) && count >= 0 && count <= 4);
const source = readFileSync(file, 'utf8');
const runtime = new Interpreter(() => {}, { sourceId: file, testing: true, args: [`--count=${count}`] });
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, count,
    mode: 'default compilation; fresh process; execution includes parsing; static analysis measured separately' }));
const start = performance.now();
try {
    runtime.execute(source);
    const executeMs = performance.now() - start;
    const sums = [0n, 219869980n, 532371800n, 892985500n, 2039506520n];
    assert.equal(runtime.variables.get('Answer'), sums[count]);
    assert.equal(runtime.variables.get('Found'), BigInt(count));
    console.log(JSON.stringify({ phase: 'execute', ms: executeMs,
        answer: String(runtime.variables.get('Answer')), found: String(runtime.variables.get('Found')),
        heapUsed: process.memoryUsage().heapUsed, maxRssKiB: process.resourceUsage().maxRSS }));
} finally { runtime.dispose(); }
const analysisStart = performance.now();
const lookup = nameFactsIn(source);
assert.ok(lookup);
let queries = 0;
for (const node of AstUtils.streamAllContents(parse(source, file))) {
    if ((isAssignmentStatement(node) || isNameExpression(node)) && node.$cstNode) {
        lookup(node.$cstNode.offset);
        queries++;
    }
}
console.log(JSON.stringify({ phase: 'static-all-name-sites', ms: performance.now() - analysisStart,
    queries, maxRssKiB: process.resourceUsage().maxRSS }));
