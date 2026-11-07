import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
const [beforeRoot, output, host, workload = 'full-compiled'] = process.argv.slice(2);
const settings = {
 'full-compiled': { mode: 'compiled', limit: '10000', pairs: 3 },
 'small-reference': { mode: 'reference', limit: '1000', pairs: 3 },
 'same-source': { mode: 'compiled', limit: '10000', pairs: 1 },
 'full-reference': { mode: 'reference', limit: '10000', pairs: 1 },
 'compat459': { mode: 'compiled', limit: '1000000', pairs: 1 },
}[workload];
if (!settings) throw Error('Unknown workload');
const { mode, limit, pairs } = settings;
function foreignNodes(allowed = new Set([process.pid])) {
 const result = spawnSync('ps', ['-eo', 'pid,pcpu,args'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
 if (result.status !== 0) throw new Error('Process monitor unavailable');
 return result.stdout.split('\n').flatMap(line => {
  const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+(.+)$/);
  if (!match || allowed.has(Number(match[1])) || !/^(?:\S*\/)?node(?:\s|$)/.test(match[3])) return [];
  const kind = /vitest/.test(match[3]) ? 'test' : /benchmark|\/bench|euler\d|rank454/.test(match[3]) ? 'benchmark' : 'node';
  return kind !== 'node' || Number(match[2]) > 30 ? [{ pid: Number(match[1]), cpu: Number(match[2]), kind }] : [];
 });
}
// Resume only the exact accepted prefix, preserving every prior sample.
const previous = existsSync(output) ? readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const schedule = Array.from({ length: pairs }, (_, pair) =>
 (pair % 2 ? ['after', 'before'] : ['before', 'after'])
  .map(variant => ({ pair, variant }))).flat();
if (previous.length > schedule.length || previous.some((value, i) =>
 value.host !== host || value.workload !== workload || value.pair !== schedule[i].pair || value.variant !== schedule[i].variant)) {
 throw new Error('Existing results do not match the requested series');
}
if (!existsSync(output)) writeFileSync(output, '');
let position = 0;
for (let pair = 0; pair < pairs; pair++) {
 const variants = pair % 2 ? ['after', 'before'] : ['before', 'after'];
 for (const variant of variants) {
  if (position++ < previous.length) continue;
  const foreign = foreignNodes();
  if (foreign.length) throw new Error(`Host busy before run: ${JSON.stringify(foreign)}`);
  let load;
  if (host === 'intel') {
   const result = spawnSync('vmstat', ['1', '2'], { encoding: 'utf8' });
   if (result.status !== 0) throw new Error('vmstat unavailable');
   const row = result.stdout.trim().split('\n').at(-1).trim().split(/\s+/).map(Number);
   load = { idle: row[14], swapIn: row[6], swapOut: row[7] };
   if (load.idle < 98 || load.swapIn || load.swapOut) throw new Error(`Host loaded: ${JSON.stringify(load)}`);
  }
  const compatibility = workload === 'compat459';
  const bench = compatibility ? 'euler459' : 'euler461';
  const file = compatibility ? 'demos/euler/459_flippinggame.ra' : variant === 'before' && workload !== 'same-source' ? 'benchmarks/fixtures/euler461-original.ra' : 'demos/euler/461_almostpi.ra';
  const env = { ...process.env, ...(variant === 'before' ? { [compatibility ? 'RANK459_RUNTIME' : 'RANK461_RUNTIME']: `${beforeRoot}/packages/interpreter/out/index.js` } : {}) };
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, [`benchmarks/${bench}.mjs`, mode, limit, file], { env });
  let stdout = '', stderr = '', checks = 0, monitorError;
  const detected = new Map();
  child.stdout.on('data', data => stdout += data);
  child.stderr.on('data', data => stderr += data);
  const timer = setInterval(() => {
   try { for (const item of foreignNodes(new Set([process.pid, child.pid]))) detected.set(item.pid, item); checks++; }
   catch (error) { monitorError = String(error); }
  }, 1000);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  clearInterval(timer);
  if (code !== 0) throw new Error(stderr || stdout);
  if (monitorError || detected.size) throw new Error(`Contaminated sample discarded: ${JSON.stringify({ monitorError, foreign: [...detected.values()] })}`);
  const value = { host, workload, pair, variant, load, startedAt, monitorChecks: checks, ...JSON.parse(stdout) };
  appendFileSync(output, JSON.stringify(value) + '\n');
  console.log(host, pair, mode, variant, value.ms.toFixed(2), value.rssMiB.toFixed(2), `checks=${checks}`);
 }
}
