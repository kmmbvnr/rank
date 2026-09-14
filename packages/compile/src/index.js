import {readFile, writeFile, mkdir, stat, rm} from 'node:fs/promises';
import {resolve, basename, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parse} from '@arrrank/interpreter';
import {analyzeWithImports, describeTypes, moduleOperations} from '@arrrank/language';

const sha = text => createHash('sha256').update(text).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const exists = async file => { try { await stat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const supportedModules = new Set(['core', 'numbers', 'sequences', 'text', 'io', 'cli']);

function syntax(node) {
  if (typeof node === 'bigint') return {integer: String(node)};
  if (Array.isArray(node)) return node.map(syntax);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).filter(([k]) => !k.startsWith('$') || k === '$type')
    .map(([k, v]) => [k, syntax(v)]));
}

function validateCases(cases, integers) {
  if (!Array.isArray(cases) || !cases.length) throw new Error('At least one verification case is required');
  for (const entry of cases) {
    if (!entry || !Array.isArray(entry.args) || !entry.args.every(arg => typeof arg === 'string'))
      throw new Error('Each case needs an args array of strings');
    if (entry.overflow !== undefined && (entry.overflow !== true || integers !== 'i64'))
      throw new Error('overflow: true is only valid in i64 mode');
    if (entry.error !== undefined && entry.error !== true) throw new Error('error must be true when specified');
    if (entry.error && entry.overflow) throw new Error('A case cannot expect both Rank error and i64 overflow');
  }
}

async function context(file, integers = 'exact') {
  if (!['exact', 'i64'].includes(integers)) throw new Error('integers must be exact or i64');
  const source = await readFile(file, 'utf8');
  const program = parse(source, basename(file));
  const facts = analyzeWithImports(program, () => undefined);
  if (facts.imports.length) throw new Error('Source imports are not supported in v0.0.1; export a self-contained program');
  if (facts.missing.length || facts.words.length) throw new Error('Resolve missing modules and unknown names before export');
  const unsupported = facts.modules.filter(name => !supportedModules.has(name));
  if (unsupported.length) throw new Error(`Unsupported modules: ${unsupported.join(', ')}`);
  const scopes = facts.scopes.map(scope => ({...scope, bindings: scope.bindings.map(b => ({...b, types: describeTypes(b.types)}))}));
  const operations = facts.operations.map(({module, name, sites}) => ({...moduleOperations(module).find(op => op.name === name), sites}));
  const companion = file.replace(/\.ra$/, '_test.ra');
  const tests = companion !== file && await exists(companion) ? await readFile(companion, 'utf8') : '';
  return {source, tests, integers, filename: basename(file), sourceSha256: sha(source),
    analysis: {modules: facts.modules, scopes, operations, syntax: syntax(program)}};
}

async function render(ctx) {
  const semantics = await readFile(new URL('../SEMANTICS.md', import.meta.url), 'utf8');
  return `# Rewrite this Rank program in Rust

You do not need prior knowledge of Rank or access to its repository. This file
supplies the source, language rules and parsed structure for the rewrite.
Create a standalone Cargo project with src/main.rs, or fill in the prepared project.
Use the source, syntax tree,
name/type/loop facts and semantic contract below. Preserve the algorithm's observable
behavior across inputs. Do not hardcode answers from tests. Do not change source.ra,
cases.json or rank-compile.json to make verification pass.

Integer policy: **${ctx.integers}**. ${ctx.integers === 'exact'
    ? 'Use signed arbitrary-precision integers for Rank integers. Declare num-bigint as below. Only use machine indices after checking conversion and bounds.'
    : 'Use signed i64 with checked arithmetic and input parsing. Overflow must fail with a diagnostic containing overflow or out of range. Never wrap or silently round. Cargo overflow checks must remain enabled.'}

Accept the source program's integer options as --lowercase-name VALUE, with their
declared defaults. Print the same stdout including its final newline. Invalid inputs
must exit nonzero with a diagnostic on stderr. Do not print build/debug logs to stdout.
Build with cargo build --release. If this is a prepared project with rank-compile.json,
run npx @arrrank/compile verify on its directory. Otherwise compare the included
examples and add boundary cases; full verification can be set up with the prepare command.
Repair counterexamples by editing the generated Rust. Finite checks are not a proof.

Initial validation covers Project Euler 1–10. This exporter does not prove that a
different parsed program can be translated. Unhandled semantics must be reported,
not silently approximated. No external agent is run by rank-compile.

${semantics}

## Cargo project

Use this manifest (there is no dependency on a Rank runtime):

\`\`\`toml
${cargo(ctx).trimEnd()}
\`\`\`

## Source: ${ctx.filename}

SHA-256: ${ctx.sourceSha256}

\`\`\`rank
${ctx.source.trimEnd()}
\`\`\`

## Existing tests (context, not a substitute for general behavior)

\`\`\`rank
${ctx.tests.trimEnd()}
\`\`\`

## Resolved syntax and analysis

This is a parsed syntax tree with binding facts, not a lowered IR or a proof of purity.
Unknown types remain unknown. Integer literals are decimal strings tagged integer.

\`\`\`json
${JSON.stringify(ctx.analysis, null, 2)}
\`\`\`
`;
}

function crateName(ctx) {
  return `rank-${basename(ctx.filename, '.ra').replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()}-${ctx.integers}`;
}

function cargo(ctx) {
  return `[package]\nname = "${crateName(ctx)}"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n\n[dependencies]\n${ctx.integers === 'exact' ? 'num-bigint = "0.4"\n' : ''}\n[profile.release]\noverflow-checks = true\n`;
}

export async function task(file, {integers = 'exact'} = {}) {
  return render(await context(file, integers));
}

export async function prepare(file, {out, integers = 'exact', casesFile} = {}) {
  if (!out) throw new Error('An output directory is required');
  const ctx = await context(file, integers);
  const cases = casesFile ? await readJson(casesFile) : [{name: 'default input', args: []}];
  validateCases(cases, integers);
  const crate = crateName(ctx);
  const prompt = await render(ctx);
  out = resolve(out);
  await mkdir(dirname(out), {recursive: true});
  await mkdir(out); // Never overwrite an existing generated project.
  await mkdir(resolve(out, 'src'));
  await Promise.all([
    writeFile(resolve(out, 'source.ra'), ctx.source),
    writeFile(resolve(out, 'source_test.ra'), ctx.tests),
    writeFile(resolve(out, 'task.md'), prompt),
    writeFile(resolve(out, 'cases.json'), json(cases)),
    writeFile(resolve(out, 'rank-compile.json'), json({schemaVersion: 1, compiler: '@arrrank/compile@0.0.1',
      sourceName: ctx.filename, sourceSha256: ctx.sourceSha256, taskSha256: sha(prompt), integers, crate})),
    writeFile(resolve(out, 'Cargo.toml'), cargo(ctx)),
    writeFile(resolve(out, 'src/main.rs'), 'compile_error!("Ask your coding agent to implement task.md before verification");\n'),
    writeFile(resolve(out, '.gitignore'), '/target/\n'),
  ]);
  return out;
}

function spawn(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options});
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.signal) throw new Error(`${command} terminated by ${result.signal}`);
  return result;
}

export async function verify(directory, {timeout = 30000} = {}) {
  if (!Number.isSafeInteger(timeout) || timeout < 1) throw new Error('timeout must be a positive integer in milliseconds');
  const out = resolve(directory);
  await rm(resolve(out, 'verification.json'), {force: true});
  const manifest = await readJson(resolve(out, 'rank-compile.json'));
  if (manifest.schemaVersion !== 1 || !['exact', 'i64'].includes(manifest.integers)) throw new Error('Unsupported manifest');
  const source = await readFile(resolve(out, 'source.ra'), 'utf8');
  if (sha(source) !== manifest.sourceSha256) throw new Error('Source changed; prepare a new task');
  if (sha(await readFile(resolve(out, 'task.md'))) !== manifest.taskSha256) throw new Error('Task changed; prepare a new task');
  const cases = await readJson(resolve(out, 'cases.json'));
  validateCases(cases, manifest.integers);
  const build = spawn('cargo', ['build', '--release', '--message-format=json', '--config', 'profile.release.overflow-checks=true',
    ...(await exists(resolve(out, 'Cargo.lock')) ? ['--locked'] : []), '--manifest-path', resolve(out, 'Cargo.toml')],
    {cwd: out, timeout: Math.max(timeout, 120000)});
  if (build.status !== 0) throw new Error(`Rust build failed:\n${build.stderr}\n${build.stdout}`);
  const artifacts = build.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line))
    .filter(entry => entry.reason === 'compiler-artifact' && entry.executable && entry.target.kind.includes('bin'));
  if (artifacts.length !== 1) throw new Error('Expected exactly one generated executable');
  const executable = artifacts[0].executable;
  const results = [];
  for (const entry of cases) {
    const ref = spawn(process.execPath, [fileURLToPath(new URL('./reference.js', import.meta.url))],
      {input: JSON.stringify({source, args: entry.args}), timeout});
    if (ref.status !== 0) throw new Error(`Rank reference failed to run: ${ref.stderr}`);
    const expected = JSON.parse(ref.stdout);
    const actual = spawn(executable, entry.args, {timeout});
    const passed = entry.overflow
      ? expected.ok && actual.status !== 0 && /overflow|out of range/i.test(actual.stderr) && actual.stdout === ''
      : entry.error
        ? !expected.ok && actual.status !== 0 && actual.stderr.length > 0 && actual.stdout === expected.stdout
        : expected.ok && actual.status === 0 && actual.stdout === expected.stdout;
    results.push({...entry, passed, expected, actual: {status: actual.status, stdout: actual.stdout, stderr: actual.stderr}});
  }
  const report = {compiler: '@arrrank/compile@0.0.1', date: new Date().toISOString(),
    integers: manifest.integers, sourceSha256: manifest.sourceSha256,
    mainSha256: sha(await readFile(resolve(out, 'src/main.rs'))),
    cargoLockSha256: sha(await readFile(resolve(out, 'Cargo.lock'))),
    casesSha256: sha(json(cases)), rust: spawn('rustc', ['--version']).stdout.trim(),
    passed: results.filter(entry => entry.passed).length, cases: results};
  await writeFile(resolve(out, 'verification.json'), json(report));
  return report;
}
