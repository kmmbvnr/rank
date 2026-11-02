import {spawn, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, existsSync, statSync, rmdirSync} from 'node:fs';
import {resolve, relative, dirname} from 'node:path';
import {hostname, cpus, totalmem} from 'node:os';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {render} from './report.mjs';

const options = Object.fromEntries(process.argv.slice(2).map(x => {
  const m = /^--([a-z-]+)=(.+)$/.exec(x);
  if (!m) throw Error(`Invalid option: ${x}`);
  return [m[1], m[2]];
}));
const root = resolve(options.checkout || '.');
const output = resolve(options.output || 'benchmarks/nightly-output');
const timeout = Number(options.timeout || 600000);
if (!(timeout > 0 && Number.isFinite(timeout))) throw Error('Invalid timeout');
const {parse} = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')));
const walk = dir => readdirSync(dir).flatMap(name => {
  const file = resolve(dir, name);
  return statSync(file).isDirectory() ? walk(file) : [file];
});
const files = walk(resolve(root, 'demos')).filter(x => x.endsWith('.ra') && !x.endsWith('_test.ra')).sort();
const sha = text => createHash('sha256').update(text).digest('hex');
const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8'}).trim();
mkdirSync(resolve(output, 'runs'), {recursive: true});
mkdirSync(resolve(output, 'metrics'), {recursive: true});
const id = new Date().toISOString().replaceAll(':', '-');
const run = {schema: 1, id, started: new Date().toISOString(), status: 'running',
  commit: git('rev-parse', 'HEAD'), subject: git('log', '-1', '--format=%s'),
  host: hostname(), cpu: cpus()[0]?.model, node: process.version, memory: totalmem(),
  timeoutMs: timeout, method: 'One fresh CLI process per demo; measured time includes parsing and execution after CLI imports. Startup is recorded separately as wallMs. Libraries run their companion tests. Sequential execution.',
  results: [], total: files.length};
const previousFiles = readdirSync(resolve(output, 'runs')).filter(x => x.endsWith('.json')).sort().reverse();
const past = previousFiles.map(x => JSON.parse(readFileSync(resolve(output, 'runs', x))));
const previous = past.find(x => x.status === 'complete' && x.method === run.method && x.node === run.node && x.cpu === run.cpu);
function atomic(file, text) { writeFileSync(file + '.tmp', text); renameSync(file + '.tmp', file); }
function save() {
  run.updated = new Date().toISOString();
  atomic(resolve(output, 'runs', id + '.json'), JSON.stringify(run));
  atomic(resolve(output, 'latest.json'), JSON.stringify(run));
  const html = render(run, previous);
  atomic(resolve(output, 'index.html'), html);
  atomic(resolve(output, 'runs', id + '.html'), html.replace('<meta charset', '<base href="../"><meta charset'));
  atomic(resolve(output, 'metrics', id + '.json'), JSON.stringify(run.results.map(({path, ms, status, workloadHash}) => ({path, ms, status, workloadHash}))));
  const history = [...past, run].map(({id, status, commit, started, method, node, cpu}) => ({id, status, commit, started, method, node, cpu})).sort((a,b) => a.id.localeCompare(b.id));
  atomic(resolve(output, 'history.json'), JSON.stringify(history));
  atomic(resolve(output, 'runs/index.html'), '<!doctype html><meta charset="utf-8"><title>Rank benchmark archive</title><h1>Run archive</h1>' + history.toReversed().map(x => `<p><a href="${x.id}.html">${x.id}</a> · ${x.status} · <a href="${x.id}.json">JSON</a></p>`).join(''));

}
let stopped = false, child;
function stop() { stopped = true; if (child) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
async function measure(file, kind) {
  return await new Promise(resolveResult => {
    const start = performance.now();
    let log = '', expired = false, memoryKilled = false;
    const command = [process.execPath, '--max-old-space-size=4096', fileURLToPath(new URL('./worker.mjs', import.meta.url)), root, kind, file];
    child = spawn(command[0], command.slice(1), {cwd: root, detached: true,
      env: {...process.env, UV_THREADPOOL_SIZE: '1', OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1'}, stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
    const pid = child.pid;
    let cgroup;
    if (process.platform === 'linux' && pid) {
      const directory = `/sys/fs/cgroup/rank-bench-${pid}`;
      try {
        mkdirSync(directory);
        writeFileSync(directory + '/memory.max', String(6 * 1024 ** 3));
        writeFileSync(directory + '/memory.swap.max', '0');
        writeFileSync(directory + '/memory.oom.group', '1');
        writeFileSync(directory + '/pids.max', '128');
        writeFileSync(directory + '/cgroup.procs', String(pid));
        cgroup = directory;
      } catch (e) {
        console.error('Kernel memory quota unavailable; using RSS guard:', e.message);
        try { rmdirSync(directory); } catch {}
      }
    }
    const kill = () => { try { process.kill(-pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => { expired = true; kill(); }, timeout);
    // Bound native array storage as well as the JS heap on Linux.
    const memory = setInterval(() => {
      try { const rss = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
        if (rss && Number(rss[1]) > 6 * 1024 * 1024) { memoryKilled = true; kill(); }
      } catch {}
    }, 250);
    const append = data => { log = (log + data.toString()).slice(-16000); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    let error, measured;
    child.on('message', value => { if (Number.isFinite(value.ms) && value.ms >= 0) measured = value.ms; });
    child.on('error', e => { error = e.message; });
    child.on('close', (code, signal) => {
      clearTimeout(timer); clearInterval(memory); child = undefined;
      if (cgroup) {
        try { memoryKilled ||= /oom_kill\s+[1-9]/.test(readFileSync(cgroup + '/memory.events', 'utf8')); } catch {}
        try { writeFileSync(cgroup + '/cgroup.kill', '1'); } catch {}
        try { rmdirSync(cgroup); } catch {}
      }
      resolveResult({ms: expired || memoryKilled || stopped ? performance.now() - start : measured ?? performance.now() - start, wallMs: performance.now() - start, status: stopped ? 'interrupted' : expired ? 'timeout' : memoryKilled ? 'memory-limit' : code === 0 ? 'ok' : 'error', code, signal, log: error || log});
    });
  });
}
let candidates = files;
if (options.only) candidates = files.filter(x => relative(root, x).includes(options.only));
if (options.limit) candidates = candidates.slice(0, Number(options.limit));
run.total = candidates.length;
save();
try {
  for (const file of candidates) {
    if (stopped) break;
    const path = relative(root, file), source = readFileSync(file, 'utf8');
    let kind = 'program', workload = file, workloadReason = 'Default program arguments';
    try {
      const program = parse(source), statements = program.statements;
      function hasStdin(node) {
        if (!node || typeof node !== 'object') return false;
        if (node.$type === 'StdinExpression') return true;
        return Object.entries(node).some(([key, value]) => !key.startsWith('$')
          && (Array.isArray(value) ? value.some(hasStdin) : hasStdin(value)));
      }
      const required = statements.some(s => s.$type === 'ArgStatement' && s.defaultValue === undefined);
      const stdin = hasStdin(program);
      const functions = statements.some(s => s.$type === 'FunctionStatement');
      const executable = statements.some(s => ['ExpressionStatement', 'ForStatement', 'IfStatement', 'TryStatement'].includes(s.$type));
      if (required || stdin || functions && !executable) {
        kind = 'tests'; workload = file.replace(/\.ra$/, '_test.ra');
        workloadReason = required ? 'Required arguments supplied by companion tests'
          : stdin ? 'Stdin workload exercised by companion tests' : 'Library companion tests';
      }
    } catch { /* Report syntax failures through the CLI. */ }
    const row = {path, group: path.split('/').slice(1, -1).join('/'), kind,
      workloadReason, sourceHash: sha(source), workload: relative(root, workload)};
    run.current = path; save();
    if (!existsSync(workload)) Object.assign(row, {status: 'no-workload', ms: null, log: 'No companion test file: ' + workloadReason});
    else Object.assign(row, {workloadHash: sha(source + readFileSync(workload, 'utf8')), ...await measure(workload, kind)});
    run.results.push(row); save();
    console.log(`${run.results.length}/${run.total} ${row.status} ${path} ${row.ms?.toFixed(0)}ms`);
  }
  run.status = stopped ? 'interrupted' : 'complete';
  if (stopped) process.exitCode = 130;
} catch (e) { run.status = 'failed'; run.error = e.stack; process.exitCode = 1; }
run.finished = new Date().toISOString(); delete run.current; save();
