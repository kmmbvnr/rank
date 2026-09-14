import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepare, task, verify} from '../src/index.js';

const source = 'use cli\nuse io\noption Limit integer = 10\nAnswer = Limit + 1\nAnswer print\n';
async function fixture(t, text = source) {
  const dir = await mkdtemp(join(tmpdir(), 'rank-compile-test-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'input.ra');
  await writeFile(file, text);
  return {dir, file};
}

test('task includes source, exact numeric policy and serialized syntax facts', async t => {
  const {file} = await fixture(t);
  const output = await task(file);
  assert.match(output, /Integer policy: \*\*exact\*\*/);
  assert.ok(output.includes(source.trim()));
  assert.match(output, /"integer": "10"/);
  assert.match(output, /loopCarried/);
  assert.match(output, /not a lowered IR or a proof of purity/);
  assert.match(output, /Reading Rank without prior knowledge/);
  assert.match(output, /\[dependencies\]/);
  assert.match(output, /num-bigint = "0.4"/);
});

test('loop-carried mutations survive export', async t => {
  const {file} = await fixture(t, 'Total = 0\nfor I in 1 to 10\n Total += I\nend\n');
  assert.match(await task(file), /"loopCarried": true/);
});

test('i64 policy is explicit and invalid policies fail', async t => {
  const {file} = await fixture(t);
  assert.match(await task(file, {integers: 'i64'}), /Never wrap or silently round/);
  await assert.rejects(task(file, {integers: 'f64'}), /exact or i64/);
});

test('unresolved names and source imports fail before creating output', async t => {
  const {file, dir} = await fixture(t, 'use "missing"\n');
  await assert.rejects(prepare(file, {out: join(dir, 'out')}), /Source imports/);
  await writeFile(file, 'Answer = unknown_name\n');
  await assert.rejects(task(file), /unknown names/);
});

test('prepare snapshots inputs and refuses to overwrite a project', async t => {
  const {file, dir} = await fixture(t);
  const out = join(dir, 'out');
  await prepare(file, {out, integers: 'i64'});
  assert.equal(await readFile(join(out, 'source.ra'), 'utf8'), source);
  assert.match(await readFile(join(out, 'src/main.rs'), 'utf8'), /compile_error!/);
  assert.doesNotMatch(await readFile(join(out, 'Cargo.toml'), 'utf8'), /num-bigint/);
  await assert.rejects(prepare(file, {out}), /EEXIST/);
});

test('verification refuses a changed source or task before invoking Cargo', async t => {
  const {file, dir} = await fixture(t);
  const out = join(dir, 'out');
  await prepare(file, {out});
  await writeFile(join(out, 'source.ra'), source + '\n');
  await assert.rejects(verify(out), /Source changed/);
  await writeFile(join(out, 'source.ra'), source);
  await writeFile(join(out, 'task.md'), 'silently changed instructions');
  await assert.rejects(verify(out), /Task changed/);
});

test('empty case suites and overflow expectations in exact mode fail', async t => {
  const {file, dir} = await fixture(t);
  const casesFile = join(dir, 'cases.json');
  await writeFile(casesFile, '[]');
  await assert.rejects(prepare(file, {out: join(dir, 'a'), casesFile}), /At least one/);
  await writeFile(casesFile, '[{"args":[],"overflow":true}]');
  await assert.rejects(prepare(file, {out: join(dir, 'b'), casesFile}), /only valid in i64/);
});

test('unknown CLI options fail without emitting a task', () => {
  const result = spawnSync(process.execPath, ['bin/cli.js', 'task', 'anything.ra', '--agent', 'unknown'], {cwd: new URL('../', import.meta.url), encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Invalid or repeated option/);
});

test('a ra file is the default command and emits the complete task without an agent', async t => {
  const {file} = await fixture(t);
  const result = spawnSync(process.execPath, ['bin/cli.js', file], {cwd: new URL('../', import.meta.url), encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, await task(file));
});

const hasCargo = spawnSync('cargo', ['--version']).status === 0;
test('verification builds a program, detects wrong output and rejects stub builds', {skip: !hasCargo}, async t => {
  const {file, dir} = await fixture(t);
  const out = join(dir, 'out');
  const casesFile = join(dir, 'cases.json');
  await writeFile(casesFile, JSON.stringify([{args: []}, {args: ['--limit', '5']}]));
  await prepare(file, {out, integers: 'i64', casesFile});
  await assert.rejects(verify(out), /Rust build failed/);
  const implementation = 'fn main() { let n: i64 = std::env::args().nth(2).unwrap_or("10".into()).parse().unwrap(); println!("{}", n+1); }\n';
  await writeFile(join(out, 'src/main.rs'), implementation);
  const good = await verify(out);
  assert.equal(good.passed, 2);
  await writeFile(join(out, 'src/main.rs'), implementation.replace('n+1', 'n+2'));
  const bad = await verify(out);
  assert.equal(bad.passed, 0);
  assert.notEqual(good.mainSha256, bad.mainSha256);
  assert.equal(bad.cases[0].expected.stdout, '11\n');
  assert.equal(bad.cases[0].actual.stdout, '12\n');
});
