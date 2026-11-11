import { pathToFileURL } from 'node:url';

const [root, name = 'large', count = '1000', memoryMode] = process.argv.slice(2);
const iterations = Number(count);
const forceGC = memoryMode === 'gc';
if (forceGC && !global.gc) throw new Error('GC mode requires --expose-gc');
if (!root || !Number.isSafeInteger(iterations) || iterations < 1) throw new Error('Usage: node compiler-budgets.mjs ROOT CASE ITERATIONS');
const { Interpreter, RuntimeDiagnostics, parse, formatValue } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
function updates(count) {
    return `use io
fun N work
${' N += 1\n'.repeat(count)} N print
 return N
end
Total = 0
for I in 1 to ${iterations}
 Total += I work
end
Total`;
}
const chain = Array.from({ length: 24 }, (_, index) => `fun N helper${index}
 return ${index < 23 ? `((N + 1) helper${index + 1}) + 1` : 'N + 1'}
end`).reverse().join('\n');
const cases = {
    small: updates(8),
    large: updates(300),
    retained: updates(1100),
    chain: `${chain}
Total = 0
for I in 1 to ${iterations}
 Total += I helper0
end
Total`,
    rank: `Values = array shape ${Array(17).fill('1').join(' ')} 2 fill 3
Total = 0
for I in 1 to ${iterations}
 for Cell in Values
  Total += Cell sum
 end
end
Total`,
    'rank-large': `Values = array shape ${Array(17).fill('1').join(' ')} 64 fill 3
Total = 0
for I in 1 to ${iterations}
 for Cell in Values
  Total += Cell sum
 end
end
Total`,
    unique: `Total = 0\nfor I in 1 to ${iterations}\n Total += I * 2\nend\nTotal`,
};
const source = cases[name];
if (!source) throw new Error(`Unknown case ${name}`);
const program = parse(source);
function run(runtime) { return formatValue(runtime.executeProgram(program)); }
const reference = new Interpreter(() => {}, { compilation: false, scalarEntryCompilation: false });
let expected;
try { expected = run(reference); } finally { reference.dispose(); }
const options = { scalarEntryCompilation: name === 'chain' };
function check(actual) { if (actual !== expected) throw new Error(`${name}: ${actual} != ${expected}`); }
const fresh = [];
for (let trial = 0; trial < 8; trial++) {
    if (forceGC) global.gc();
    const runtime = new Interpreter(() => {}, options);
    const start = performance.now();
    try { check(run(runtime)); } finally { runtime.dispose(); }
    fresh.push(performance.now() - start);
}
const runtime = new Interpreter(() => {}, options), prepared = [];
try {
    for (let trial = 0; trial < 12; trial++) {
        if (forceGC) global.gc();
        const start = performance.now();
        check(run(runtime));
        prepared.push(performance.now() - start);
    }
} finally { runtime.dispose(); }
const diagnostics = new RuntimeDiagnostics(), observed = new Interpreter(() => {}, options);
try { check(diagnostics.run(() => run(observed))); } finally { observed.dispose(); }
if (forceGC) global.gc();
console.log(JSON.stringify({ name, iterations, forceGC, expected, fresh, prepared, rssKiB: process.resourceUsage().maxRSS,
    memory: process.memoryUsage(), node: process.version, arch: process.arch,
    diagnostics: { compiledLoops: diagnostics.compiledLoops, numberLoops: diagnostics.numberLoops, compiledValueBlocks: diagnostics.compiledValueBlocks,
        compiledFramedFunctions: diagnostics.compiledFramedFunctions,
        compiledGeneratorLoops: diagnostics.compiledGeneratorLoops,
        cowCopies: diagnostics.cowCopies, cowCopiedCells: diagnostics.cowCopiedCells,
        costs: diagnostics.costs } }));
