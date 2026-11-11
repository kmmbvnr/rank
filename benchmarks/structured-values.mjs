import { pathToFileURL } from 'node:url';
const [root, name] = process.argv.slice(2);
const sources = {
    record: `fun State advance
 Next = State with
  .count += 1
 end
 return Next
end
State = record
 .count = 0
 .name = "Ada"
end
for I in 1 to 2000
 State = State advance
end
State .count`,
    tuple: `fun N pair
 return tuple N "ok"
end
Total = 0
for I in 1 to 2000
 unpack Count Name = I pair
 Total += Count
end
Total`,
    queue: `use algo
fun Store append Value
 Store push Value
 return Store
end
fun Store takeitem
 return Store pop
end
Store = new queue
Last = ""
for I in 1 to 2000
 Store = Store append "hello"
 Last = Store takeitem
end
Last`,
    fields: `State = record
 .count = 0
end
for I in 1 to 2000
 State .count += I
end
State .count`,
    scalar: `fun N square
 return N * N
end
Total = 0
for I in 1 to 2000
 Total += I square
end
Total`,
};
const expected = { record: '2000', tuple: '2001000', queue: 'hello', fields: '2001000', scalar: '2668667000' };
if (!root || !sources[name]) throw new Error('Usage: node benchmarks/structured-values.mjs ROOT record|tuple|queue|fields|scalar');
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
