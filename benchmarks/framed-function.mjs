import { pathToFileURL } from 'node:url';
const [root, name] = process.argv.slice(2);
const sources = {
  nested: `fun Offset outer
 fun X shifted
  return X + Offset
 end
 Result = 3 shifted
 return Result + 1
end
Total = 0
for I in 1 to 2000
 Total += I outer
end
Total`,
  mutual: `fun N even
 if N equal 0
  return true
 end
 return (N - 1) odd
end
fun N odd
 if N equal 0
  return false
 end
 return (N - 1) even
end
10000 even`,
  resumed: `fun N first
 if N equal 0
  return 0
 end
 return ((N - 1) second) + 1
end
fun N second
 if N equal 0
  return 0
 end
 return ((N - 1) first) + 1
end
500 first`,
};
if (!root || !sources[name]) throw new Error('Usage: node benchmarks/framed-function.mjs ROOT nested|mutual|resumed');
const { Interpreter, formatValue } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
function run() {
  const runtime = new Interpreter();
  try { return formatValue(runtime.execute(sources[name])); }
  finally { runtime.dispose(); }
}
const start = performance.now(), result = run(), cold = performance.now() - start;
const samples = [];
for (let i = 0; i < 5; i++) { const start = performance.now(); if (run() !== result) throw new Error('unstable result'); samples.push(performance.now() - start); }
console.log(JSON.stringify({ name, result, cold, median: samples.sort((a,b)=>a-b)[2], rssKiB: process.resourceUsage().maxRSS, node: process.version }));
