import { pathToFileURL } from 'node:url';
const { Interpreter } = await import(process.env.RANK529_RUNTIME
    ? pathToFileURL(process.env.RANK529_RUNTIME)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const runtime = new Interpreter(() => {});
try {
    runtime.execute(`use sequences
Places = 0 till 10000 copy
Keys = Places mod 1024
Input = array shape 10000 fill 1
fun Turns scalar
 Counts = array shape 1024 fill 0
 for Turn in 1 to Turns
  Counts Keys += 1 .accumulate
 end
 return Counts
end
fun Turns vector
 Counts = array shape 1024 fill 0
 for Turn in 1 to Turns
  Counts Keys += Input .accumulate
 end
 return Counts
end`);
    const records = [];
    for (const name of ['scalar', 'vector']) {
        const fn = runtime.variables.get(name);
        fn.call([100n]); fn.call([100n]);
        for (let trial = 0; trial < 5; trial++) {
            const start = performance.now(), cpu = process.cpuUsage();
            const result = fn.call([1000n]);
            if (result.items.reduce((sum, x) => sum + x, 0n) !== 10000000n) throw Error('wrong histogram');
            records.push({ name, trial, ms: performance.now() - start, cpu: process.cpuUsage(cpu) });
        }
    }
    console.log(JSON.stringify({ node: process.version, arch: process.arch, records }));
} finally { runtime.dispose(); }
