import { pathToFileURL } from 'node:url';
const [root, selector = 'literal', count = '2000', memoryMode] = process.argv.slice(2);
const iterations = Number(count);
const forceGC = memoryMode === 'gc';
if (forceGC && !global.gc) throw new Error('The gc measurement mode requires --expose-gc');
if (!root || !['literal', 'bound'].includes(selector) || !Number.isSafeInteger(iterations) || iterations < 1) {
    throw new Error('Usage: node benchmarks/gather-regression.mjs ROOT [literal|bound] [iterations]');
}
const { Interpreter, parse, formatValue } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const source = `use sequences
M = (0 till 24) reshape 2 3 4
Rows = array 1 0
Columns = array 3 0
Total = 0
for I in 1 to ${iterations}
 Part = M ${selector === 'literal' ? '(array 1 0) 1 (array 3 0)' : 'Rows 1 Columns'}
 Total += Part sum rank 2
end
Total`;
const expected = String(46n * BigInt(iterations));
function check(value) {
    const result = formatValue(value);
    if (result !== expected) throw new Error(`Expected ${expected}, got ${result}`);
}
const fresh = [];
for (let i = 0; i < 9; i++) {
    if (forceGC) global.gc();
    const runtime = new Interpreter();
    const start = performance.now();
    try { check(runtime.execute(source)); }
    finally { runtime.dispose(); }
    fresh.push(performance.now() - start);
}
const program = parse(source), runtime = new Interpreter();
const prepared = [];
try {
    for (let i = 0; i < 13; i++) {
        if (forceGC) global.gc();
        const start = performance.now();
        check(runtime.executeProgram(program));
        prepared.push(performance.now() - start);
    }
} finally { runtime.dispose(); }
if (forceGC) global.gc();
const retainedAfterGC = forceGC ? process.memoryUsage() : undefined;
console.log(JSON.stringify({ selector, iterations, fresh, prepared, forceGC, retainedAfterGC, rssKiB: process.resourceUsage().maxRSS, node: process.version }));
