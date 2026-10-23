// Build first: npx tsc -b tsconfig.build.json
// Run: node benchmarks/function-control.mjs [calls] [samples]
import { performance } from 'node:perf_hooks';
import { Interpreter, isNativeFunction } from '../packages/interpreter/out/index.js';

const calls = Number(process.argv[2] ?? 20000), samples = Number(process.argv[3] ?? 5);
if (![calls, samples].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Expected positive calls and samples');
const source = `fun X increment
  Value = X + 1
  return Value
end
fun N count Total
  if N equal 0
    return Total
  end
  return (N - 1) count (Total + 1)
end`;
const runtimes = [false, true].map(directFunctionControl => {
    const runtime = new Interpreter(undefined, { compilation: false, directFunctionControl, maxCallDepth: 1 });
    runtime.execute(source);
    const increment = runtime.variables.get('increment'), count = runtime.variables.get('count');
    if (!isNativeFunction(increment) || !isNativeFunction(count)) throw new Error('Missing function');
    return { runtime, increment, count, directFunctionControl, results: [] };
});
function measure({ increment, count }) {
    const start = performance.now();
    for (let index = 0; index < calls; index++) if (increment.call([1n]) !== 2n) throw new Error('Incorrect return');
    const returnsMilliseconds = performance.now() - start;
    const tailStart = performance.now();
    if (count.call([BigInt(calls), 0n]) !== BigInt(calls)) throw new Error('Incorrect tail result');
    return { returnsMilliseconds, tailMilliseconds: performance.now() - tailStart };
}
try {
    for (const run of runtimes) measure(run);
    for (let sample = 0; sample < samples; sample++) {
        for (const run of sample % 2 ? [...runtimes].reverse() : runtimes) run.results.push(measure(run));
    }
    const median = (results, key) => results.map(row => row[key]).sort((a, b) => a - b)[Math.floor(samples / 2)];
    console.log(JSON.stringify({ calls, samples, results: runtimes.map(({ directFunctionControl, results }) => ({
        directFunctionControl, medianReturnsMilliseconds: median(results, 'returnsMilliseconds'),
        medianTailMilliseconds: median(results, 'tailMilliseconds'), results,
    })) }, null, 2));
} finally { for (const { runtime } of runtimes) runtime.dispose(); }
