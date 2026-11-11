import { pathToFileURL } from 'node:url';
const { Interpreter } = await import(process.env.RANK590_RUNTIME ? pathToFileURL(process.env.RANK590_RUNTIME)
    : new URL('../packages/interpreter/out/index.js', import.meta.url));
const n = Number(process.argv[2] ?? 8192), modulus = 1953125n;
const runtime = new Interpreter(() => {}, { compilation: false });
try {
    const start = performance.now();
    runtime.execute(`use sequences\nSlots' = 0 till ${n}\nTwos' = Slots * 0 + 2\nPowers = Twos scan * with 1 mod ${modulus}\nLast = Powers ${n}`);
    const answer = runtime.variables.get('Last');
    if (answer !== 2n ** BigInt(n) % modulus) throw Error('Wrong residue');
    console.log(JSON.stringify({ n, node: process.version, arch: process.arch, ms: performance.now() - start,
        rssMiB: process.resourceUsage().maxRSS / 1024, answer: String(answer) }));
} finally { runtime.dispose(); }
