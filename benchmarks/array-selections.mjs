import { pathToFileURL } from 'node:url';
const [root, name] = process.argv.slice(2);
const sources = {
    gather: `use sequences
M = (0 till 24) reshape 2 3 4
Total = 0
for I in 1 to 2000
 Part = M (array 1 0) 1 (array 3 0)
 Total += Part sum rank 2
end
Total`,
    mask: `use sequences
M = (0 till 24) reshape 2 3 4
Mask = array true false true
Total = 0
for I in 1 to 2000
 Part = M # Mask 2
 Total += Part sum rank 2
end
Total`,
    scatter: `M = array shape 2 3 fill 0.5
Keys = array 1 1 2
for I in 1 to 2000
 M # Keys += 1.0
end
M sum rank 2`,
    axis: `use sequences
M = (0 till 4000) reshape 2 2000
Total = 0
for Col I in M axis 1
 Total += Col 1
end
Total`,
    scalar: `fun N square
 return N * N
end
Total = 0
for I in 1 to 2000
 Total += I square
end
Total`,
};
const expected = { gather: '92000', mask: '96000', scatter: '8003', axis: '5999000', scalar: '2668667000' };
if (!root || !sources[name]) throw new Error('Usage: node benchmarks/array-selections.mjs ROOT gather|mask|scatter|axis|scalar');
const { Interpreter, formatValue } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
function run() {
    const runtime = new Interpreter();
    try {
        const result = formatValue(runtime.execute(sources[name]));
        if (result !== expected[name]) throw new Error(`${name}: expected ${expected[name]}, got ${result}`);
        return result;
    } finally { runtime.dispose(); }
}
const start = performance.now(), result = run(), cold = performance.now() - start;
const samples = [];
for (let i = 0; i < 5; i++) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
}
console.log(JSON.stringify({ name, result, cold, samples, median: [...samples].sort((a, b) => a - b)[2],
    rssKiB: process.resourceUsage().maxRSS, node: process.version }));
