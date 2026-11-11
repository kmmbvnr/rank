import { pathToFileURL } from 'node:url';

const [root, name = 'scalar', count = '1000', memoryMode] = process.argv.slice(2);
const iterations = Number(count);
const forceGC = memoryMode === 'gc';
if (forceGC && !global.gc) throw new Error('GC mode requires --expose-gc');
if (!root || !Number.isSafeInteger(iterations) || iterations < 1) throw new Error('Usage: node deferred-composition.mjs ROOT CASE ITERATIONS');
const { Interpreter, RuntimeDiagnostics, parse, formatValue } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const cases = {
    scalar: `Total = 0\nfor I in 1 to ${iterations}\n Value' = I * 2\n Total += Value\nend\nTotal`,
    rebind: `Total = 0\nfor I in 1 to ${iterations}\n Value' = I * 2\n First = Value\n Value' = I * 3\n Total += First + Value\nend\nTotal`,
    helper: `fun X' twice\n return X + X\nend\nTotal = 0\nfor I in 1 to ${iterations}\n Value' = I * 2\n Total += Value twice\nend\nTotal`,
    escape: `fun N make\n First' = N + 1\n Second' = First * 2\n return Second\nend\nTotal = 0\nfor I in 1 to ${iterations}\n Saved' = I make\n Total += Saved\nend\nTotal`,
    array: `fun A make\n Values' = A * 2\n return Values\nend\nSource = array 1 2 3 4\nTotal = 0\nfor I in 1 to ${iterations}\n Saved' = Source make\n Total += Saved sum\nend\nTotal`,
    unique: `Total = 0\nfor I in 1 to ${iterations}\n Total += I * 2\nend\nTotal`,
};
const source = cases[name];
if (!source) throw new Error(`Unknown case ${name}`);
const program = parse(source);
function run(runtime) { return formatValue(runtime.executeProgram(program)); }
const reference = new Interpreter(() => {}, { compilation: false, scalarEntryCompilation: false });
let expected;
try { expected = run(reference); } finally { reference.dispose(); }
const options = { scalarEntryCompilation: false };
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
        cowCopies: diagnostics.cowCopies, cowCopiedCells: diagnostics.cowCopiedCells,
        costs: diagnostics.costs } }));
