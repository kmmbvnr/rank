import { pathToFileURL } from 'node:url';
const root = process.env.RANK_ARRAY_RUNTIME;
const runtime = root ? pathToFileURL(`${root}/index.js`) : new URL('../packages/interpreter/out/index.js', import.meta.url);
const storage = root ? pathToFileURL(`${root}/array-storage.js`) : new URL('../packages/interpreter/out/array-storage.js', import.meta.url);
const { Interpreter, isRankArray } = await import(runtime);
const { typedArray, readArrayItem } = await import(storage);
const mode = process.argv[2] ?? 'compiled';
const interpreter = new Interpreter(() => {}, { compilation: mode !== 'reference' });
interpreter.variables.set('A', typedArray(Float64Array.from({ length: 256 }, (_, i) => i / 8), [256, 1]));
interpreter.variables.set('B', typedArray(Float64Array.from({ length: 256 }, (_, i) => i / 16), [1, 256]));
interpreter.execute(`Bias = 2.5
fun Left mix Right
  Low = Left min Right
  High = Left max Right
  Flag = Left greater Right integer
  return (High - Low + Flag) * Bias
end`);
try {
    const start = performance.now();
    for (let i = 0; i < 50; i++) {
        const result = interpreter.execute('A mix B');
        if (!isRankArray(result) || result.shape.join() !== '256,256'
            || readArrayItem(result, 256) !== 2.8125 || readArrayItem(result, 65535) !== 42.34375)
            throw Error('Incorrect broadcast result');
    }
    console.log(JSON.stringify({ mode, node: process.version, arch: process.arch, runtime: root ?? 'current',
        ms: performance.now() - start, rssMiB: process.resourceUsage().maxRSS / 1024 }));
} finally { interpreter.dispose(); }
