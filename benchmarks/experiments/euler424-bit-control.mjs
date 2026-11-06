const { Interpreter } = await import(process.env.RANK424_RUNTIME ?? new URL('../../packages/interpreter/out/index.js', import.meta.url));
const runtime = new Interpreter();
const source = `Total = 0
for I in 1 to Limit
 Total += I band 1023
end
Total`;
try {
    runtime.execute('use bits\nLimit = 100000');
    runtime.execute(source);
    runtime.execute('Limit = 10000000');
    const samples = [];
    for (let sample = 0; sample < 3; sample++) {
        const start = performance.now(), value = runtime.execute(source);
        samples.push({ ms: performance.now() - start, answer: String(value) });
    }
    console.log(JSON.stringify({ node: process.version, case: 'Int32 band accumulation, warm same interpreter, 10 million iterations', samples }));
} finally { runtime.dispose(); }
