import { pathToFileURL } from 'node:url';

const [root, name = 'slice', count = '1000', memoryMode] = process.argv.slice(2);
const iterations = Number(count);
const forceGC = memoryMode === 'gc';
if (forceGC && !global.gc) throw new Error('GC mode requires --expose-gc');
if (!root || !Number.isSafeInteger(iterations) || iterations < 1) throw new Error('Usage: node array-ownership.mjs ROOT CASE ITERATIONS');
const { Interpreter, RuntimeDiagnostics, parse, formatValue } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const cases = {
    alias: `fun A pass\n return A\nend\nSource = array shape 1000 fill 0\nSaved = Source\nfor I in 1 to ${iterations}\n Saved = Source pass\n Source 0 += 1\n Source 1 += 1\nend\ntuple (Source 0) (Saved 0)`,
    slice: `fun A edge\n return A (0 to 1)\nend\nSource = array shape 10000 fill 0\nSaved = array 0 0\nfor I in 1 to ${iterations}\n Saved = Source edge\n Source 0 += 1\nend\ntuple (Source 0) (Saved 0)`,
    fresh: `fun N row\n return array shape 64 fill N\nend\nTotal = 0\nfor I in 1 to ${iterations}\n Current = I row\n Current 0 += 1\n Total += Current 0\nend\nTotal`,
    deque: `use algo\nSource = array shape 64 fill 0\nQueue = new queue\nfor I in 1 to ${iterations}\n Queue push Source\n Source 0 += 1\nend\nSaved = Queue pop\ntuple (Source 0) (Saved 0)`,
    read: `fun A edge\n return A (0 to 1)\nend\nSource = array shape 10000 fill 7\nTotal = 0\nfor I in 1 to ${iterations}\n Saved = Source edge\n Total += Saved 0\nend\nTotal`,
    unique: `Source = array shape 1000 fill 0\nfor I in 1 to ${iterations}\n Source (I mod 1000) += 1\nend\nSource sum`,
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
    diagnostics: { compiledLoops: diagnostics.compiledLoops, numberLoops: diagnostics.numberLoops,
        cowCopies: diagnostics.cowCopies, cowCopiedCells: diagnostics.cowCopiedCells,
        costs: diagnostics.costs } }));
