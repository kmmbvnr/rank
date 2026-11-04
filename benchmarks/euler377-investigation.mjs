import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';

const {Interpreter, RuntimeDiagnostics} = await import(new URL(
  process.env.RUNTIME || '../packages/interpreter/out/index.js', import.meta.url,
));
const [file = 'demos/euler/377_digitexperience.ra', mode = 'compiled', terms = '17'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const diagnostics = new RuntimeDiagnostics();
let answer;
const runtime = new Interpreter(value => { answer = value; }, {
  compilation: mode !== 'reference', args: ['--terms', terms],
});
let session;
if (process.env.PROFILE) {
  session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.start');
}
const start = performance.now();
try {
  if (process.env.DIAG) diagnostics.run(() => runtime.execute(source));
  else runtime.execute(source);
  const ms = performance.now() - start;
  const expected = {0: '0', 1: '856884757', 17: '732385277'}[terms];
  if (expected !== undefined) assert.equal(String(answer).trim(), expected);
  console.log(JSON.stringify({
    file, mode, terms, answer, ms,
    rssMiB: process.resourceUsage().maxRSS / 1024,
    ...(process.env.DIAG ? {diagnostics} : {}),
  }));
  if (session) {
    const {profile} = await session.post('Profiler.stop');
    writeFileSync(process.env.PROFILE, JSON.stringify(profile));
  }
} finally {
  runtime.dispose();
  session?.disconnect();
}
