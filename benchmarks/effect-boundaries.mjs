import { pathToFileURL } from 'node:url';

const [root, name = 'helper', count = '1000', memoryMode] = process.argv.slice(2);
const iterations = Number(count);
const forceGC = memoryMode === 'gc';
if (forceGC && !global.gc) throw new Error('GC mode requires --expose-gc');
if (!root || !Number.isSafeInteger(iterations) || iterations < 1) throw new Error('Usage: node effect-boundaries.mjs ROOT CASE ITERATIONS');
const { Interpreter, RuntimeDiagnostics, parse, formatValue } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const cases = {
    helper: `use io
fun N report
 N print
 return N + 1
end
Total = 0
for I in 1 to ${iterations}
 Before = I * I + 1
 Current = I report
 Total += Before + Current
end
Total`,
    protected: `use io
fun N work
 try
  N print
  return N * 2
 finally
  N print
 end
end
Total = 0
for I in 1 to ${iterations}
 Total += I work
end
Total`,
    generator: `fun values
 for N in 1 to ${iterations}
  try
   yield N
  finally
   yield N + 1
  end
 end
end
values sum`,
    nested: `fun values
 for N in 1 to ${iterations}
  for I in 1 to 2
   yield N + I
  end
 end
end
values sum`,
    'nested-protected': `fun values
 for N in 1 to ${iterations}
  for I in 1 to 2
   try
    yield N + I
   finally
    N + 1
   end
  end
 end
end
values sum`,
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
        compiledGeneratorLoops: diagnostics.compiledGeneratorLoops,
        cowCopies: diagnostics.cowCopies, cowCopiedCells: diagnostics.cowCopiedCells,
        costs: diagnostics.costs } }));
