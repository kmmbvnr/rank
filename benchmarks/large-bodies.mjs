import { pathToFileURL } from 'node:url';

const [rootSpec, name = 'large', count = '100', memoryMode] = process.argv.slice(2);
const referenceMode = rootSpec?.endsWith('#reference');
const root = referenceMode ? rootSpec.slice(0, -10) : rootSpec;
const iterations = Number(count);
const forceGC = memoryMode === 'gc';
if (forceGC && !global.gc) throw new Error('GC mode requires --expose-gc');
if (!root || !Number.isSafeInteger(iterations) || iterations < 1) throw new Error('Usage: node large-bodies.mjs ROOT[#reference] CASE ITERATIONS');
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
function body(commands, calls = iterations, input = 'I', imports = '') {
    return `use io\n${imports}fun N work\n${commands} N print\n return N\nend\nTotal = 0\nfor I in 1 to ${calls}\n Result = ${input} work\n Total += Result sum\nend\nTotal`;
}
const cases = {
    small: updates(8), large: updates(300), retained: updates(1100),
    arithmetic: body(' N = (N * 3 + 7) mod 1000000007\n'.repeat(300)),
    mixed: body(' N *= 2\n N -= 1\n N += 3\n'.repeat(100)),
    branches: body(' if N mod 2 equal 0\n  N += 1\n else\n  N += 2\n end\n'.repeat(100)),
    arrays: body(' N += 1\n'.repeat(300), Math.max(1, Math.floor(iterations / 50)), '(array shape 4096 fill I)', 'use sequences\n'),
};
const source = cases[name];
if (!source) throw new Error(`Unknown case ${name}`);
const program = parse(source);
function run(runtime) { return formatValue(runtime.executeProgram(program)); }
const reference = new Interpreter(() => {}, { compilation: false, scalarEntryCompilation: false });
let expected;
try { expected = run(reference); } finally { reference.dispose(); }
const options = { compilation: !referenceMode };
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
console.log(JSON.stringify({ name, iterations, referenceMode, forceGC, expected, fresh, prepared, rssKiB: process.resourceUsage().maxRSS,
    memory: process.memoryUsage(), node: process.version, arch: process.arch,
    diagnostics: { compiledLoops: diagnostics.compiledLoops, numberLoops: diagnostics.numberLoops, compiledValueBlocks: diagnostics.compiledValueBlocks,
        compiledFramedFunctions: diagnostics.compiledFramedFunctions,
        compiledGeneratorLoops: diagnostics.compiledGeneratorLoops,
        cowCopies: diagnostics.cowCopies, cowCopiedCells: diagnostics.cowCopiedCells,
        costs: diagnostics.costs } }));
