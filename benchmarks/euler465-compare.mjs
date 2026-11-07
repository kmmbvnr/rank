import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
const [beforeRoot, output, host, workload = 'full-compiled'] = process.argv.slice(2);
const settings = {
 'full-compiled': { mode: 'compiled', limit: '96889010407', pairs: 3 },
 'full-reference': { mode: 'reference', limit: '96889010407', pairs: 3 },
 'cutoff': { mode: 'compiled', limit: '96889010407', pairs: 3 },
}[workload];
if (!settings) throw Error('Unknown workload');
const { mode, limit, pairs } = settings;
const variantsFor = pair => settings.afterOnly ? ['after'] : pair % 2 ? ['after', 'before'] : ['before', 'after'];
// The controller and its ancestors are part of the harness, not foreign jobs.
const controllerPids = new Set([process.pid]);
for (let pid = process.ppid; pid > 1 && !controllerPids.has(pid);) {
 controllerPids.add(pid);
 const result = spawnSync('ps', ['-p', String(pid), '-o', 'ppid='], { encoding: 'utf8' });
 if (result.status !== 0) break;
 pid = Number(result.stdout.trim());
}
function foreignNodes(allowed = controllerPids) {
 const result = spawnSync('ps', ['-eo', 'pid,pcpu,args'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
 if (result.status !== 0) throw new Error('Process monitor unavailable');
 return result.stdout.split('\n').flatMap(line => {
  const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+(.+)$/);
  if (!match || allowed.has(Number(match[1])) || controllerPids.has(Number(match[1]))) return [];
  const node = /^(?:\S*\/)?node(?:\s|$)/.test(match[3]);
  if (!node) {
   if (/^(?:\S*\/)?(?:ps|sshd(?:-session)?|vmstat|sleep)(?:[:\s]|$)/.test(match[3])) return [];
   return Number(match[2]) > 30 ? [{ pid: Number(match[1]), cpu: Number(match[2]), kind: 'external' }] : [];
  }
  const kind = /vitest/.test(match[3]) ? 'test' : /benchmark|\/bench|euler\d|rank454/.test(match[3]) ? 'benchmark' : 'node';
  return kind !== 'node' || Number(match[2]) > 30 ? [{ pid: Number(match[1]), cpu: Number(match[2]), kind }] : [];
 });
}
// Resume only the exact accepted prefix, preserving every prior sample.
const previous = existsSync(output) ? readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const schedule = Array.from({ length: pairs }, (_, pair) =>
 variantsFor(pair)
  .map(variant => ({ pair, variant }))).flat();
if (previous.length > schedule.length || previous.some((value, i) =>
 value.host !== host || value.workload !== workload || value.pair !== schedule[i].pair || value.variant !== schedule[i].variant)) {
 throw new Error('Existing results do not match the requested series');
}
if (!existsSync(output)) writeFileSync(output, '');
let position = 0;
for (let pair = 0; pair < pairs; pair++) {
 const variants = variantsFor(pair);
 for (const variant of variants) {
  if (position++ < previous.length) continue;
  const foreign = foreignNodes();
  if (foreign.length) throw new Error(`Host busy before run: ${JSON.stringify(foreign)}`);
  let load;
  if (host === 'intel') {
   const result = spawnSync('vmstat', ['1', '2'], { encoding: 'utf8' });
   if (result.status !== 0) throw new Error('vmstat unavailable');
   const row = result.stdout.trim().split('\n').at(-1).trim().split(/\s+/).map(Number);
   load = { idle: row[14], ioWait: row[15], user: row[12], system: row[13], swapIn: row[6], swapOut: row[7], allowIoWait: process.env.RANK465_ALLOW_IO_WAIT === 'true' };
   const inactive = load.idle + (load.allowIoWait ? load.ioWait : 0);
   // The explicit I/O-background lane permits up to 5% active CPU.
   // Keep it separate from the default quiet-host series in reports.
   load.requiredInactive = load.allowIoWait ? 95 : 98;
   if (inactive < load.requiredInactive || load.swapIn || load.swapOut) throw new Error(`Host loaded: ${JSON.stringify(load)}`);
  }
  const bench = 'euler465';
  const file = variant === 'before' && workload !== 'cutoff' ? 'benchmarks/fixtures/euler465-original.ra' : 'demos/euler/465_polarpolygons.ra';
  const env = { ...process.env, ...(variant === 'before' && workload !== 'cutoff' ? { RANK465_RUNTIME: `${beforeRoot}/packages/interpreter/out/index.js` } : {}) };
  const startedAt = new Date().toISOString();
  const extra = workload === 'cutoff' && variant === 'before' ? [`--limit=${Math.floor(Number(limit) ** (2 / 3)) + 10}`] : [];
  const child = spawn(process.execPath, [`benchmarks/${bench}.mjs`, mode, limit, file, ...extra], { env });
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
  const value = { host, workload, pair, variant, load, startedAt, controllerPids: [...controllerPids], monitorChecks: checks, ...JSON.parse(stdout) };
  if (monitorError || detected.size) {
   const rejection = { monitorError, foreign: [...detected.values()], sample: value };
   appendFileSync(output + '.rejected.jsonl', JSON.stringify(rejection) + '\n');
   throw new Error(`Contaminated sample retained separately: ${JSON.stringify({ monitorError, foreign: rejection.foreign })}`);
  }
  appendFileSync(output, JSON.stringify(value) + '\n');
  console.log(host, pair, mode, variant, value.ms.toFixed(2), value.rssMiB.toFixed(2), `checks=${checks}`);
 }
}
