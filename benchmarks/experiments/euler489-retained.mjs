import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
if (!global.gc) throw Error('Run with --expose-gc');
const [file = 'demos/euler/489_commonfactors.ra', chosen] = process.argv.slice(2);
const { Interpreter } = await import(chosen ? pathToFileURL(chosen) : new URL('../../packages/interpreter/out/index.js', import.meta.url));
const runtime = new Interpreter(() => {}), source = readFileSync(file, 'utf8'), runs = [];
const start = source.lastIndexOf('\nAnswer = 0\n');
if (start < 0) throw Error('Missing program entry');
const entry = source.slice(start + 1);
try {
 for (let i = 0; i < 3; i++) {
  runtime.execute(i === 0 ? source : entry);
  if ((runtime.variables.get('Answer') ?? runtime.lastResult) !== 1791954757162n) throw Error('Wrong answer');
  for (let j = 0; j < 3; j++) { global.gc(); await new Promise(resolve => setImmediate(resolve)); }
  const memory = process.memoryUsage();
  runs.push({ heapMiB: memory.heapUsed / 2 ** 20, arrayBuffersMiB: memory.arrayBuffers / 2 ** 20 });
 }
 console.log(JSON.stringify({ node: process.version, arch: process.arch, file, sourceSha256: createHash('sha256').update(source).digest('hex'), runs,
  rssMiB: process.resourceUsage().maxRSS / 1024 }));
} finally { runtime.dispose(); }
