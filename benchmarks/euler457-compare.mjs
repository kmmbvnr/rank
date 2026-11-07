import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, appendFileSync } from 'node:fs';
const [beforeRoot, output, host] = process.argv.slice(2);
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
writeFileSync(output, '');
for (let pair = 0; pair < 3; pair++) for (const mode of ['compiled', 'reference']) {
 const variants = mode === 'compiled' ? ['before', 'compiler', 'after'] : ['before', 'after'];
 if (pair % 2) variants.reverse();
 for (const variant of variants) {
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
  const file = variant === 'after' ? 'demos/euler/457_polynomialmodulosquare.ra' : 'benchmarks/fixtures/euler457-original.ra';
  const env = { ...process.env, ...(variant === 'before' ? { RANK457_RUNTIME: `${beforeRoot}/packages/interpreter/out/index.js` } : {}) };
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, ['benchmarks/euler457.mjs', mode, '10000000', file], { env });
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
  const value = { host, pair, variant, load, startedAt, monitorChecks: checks, ...JSON.parse(stdout) };
  appendFileSync(output, JSON.stringify(value) + '\n');
  console.log(host, pair, mode, variant, value.ms.toFixed(2), value.rssMiB.toFixed(2), `checks=${checks}`);
 }
}
