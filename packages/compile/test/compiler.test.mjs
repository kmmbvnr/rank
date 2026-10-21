import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepare, task, verify} from '../src/index.js';

const source = 'use cli\nuse io\noption Limit integer = 10\nAnswer = Limit + 1\nAnswer print\n';
const planSource = `use io
use sequences
use cli
option Limit integer = 3
fun X mark
 X print
 return X
end
fun X' transform
 "entered" print
 Work' = X + 1
 return Work
end
fun X stats = (X sum) + (X sum)
Source' = 1 to Limit
Selected' = Source mark rank 0
Result' = Selected transform
Quotient' = 12 // Limit
Limit = 0
Saved = Result
Saved sum print
Result sum print
Saved sum print
Selected stats print
Quotient print
`;
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

test('export preserves binding modes, parameter modes and references without apostrophes', async t => {
  const {file} = await fixture(t, planSource);
  const output = await task(file);
  const analysis = JSON.parse(output.match(/```json\n([\s\S]*?)\n```/)[1]);
  const statements = analysis.syntax.statements;
  const binding = name => statements.find(s => s.$type === 'AssignmentStatement' && s.name === name);
  for (const name of ['Source', 'Selected', 'Result', 'Quotient']) assert.equal(binding(name).deferred, true);
  assert.equal(binding('Saved').deferred, false);
  assert.equal(binding('Saved').value.name, 'Result');
  const functions = statements.filter(s => s.$type === 'FunctionStatement');
  assert.equal(functions.find(s => s.name === 'mark').leftBindings[0].deferred, false);
  const transform = functions.find(s => s.name === 'transform');
  assert.equal(transform.leftBindings[0].deferred, true);
  assert.equal(transform.statements[1].deferred, true);
  assert.equal(transform.statements[2].value.name, 'Work');
  assert.match(output, /Each demand of a plan\nrecomputes it, including effects and failures/);
  assert.match(output, /A call executes its body now/);
  assert.match(output, /ordinary bindings are completion boundaries/);
});

test('invalid captured writes and deferred parameter writes fail before creating output', async t => {
  const {file, dir} = await fixture(t);
  for (const text of [
    "A = array 1 2\nPlan' = A * 2\nA 0 = 9\n",
    "fun X' change\n X 0 = 9\n return X\nend\n",
  ]) {
    await writeFile(file, text);
    const out = join(dir, 'out');
    await assert.rejects(prepare(file, {out}), /read-only/);
    await assert.rejects(readFile(join(out, 'source.ra')), {code: 'ENOENT'});
  }
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
test('Rust verification checks replay effects, capture, eager parameters and deferred failures', {skip: !hasCargo}, async t => {
  const {file, dir} = await fixture(t, planSource);
  const out = join(dir, 'out');
  const casesFile = join(dir, 'cases.json');
  await writeFile(casesFile, JSON.stringify([
    {args: []}, {args: ['--limit', '0'], error: true}, {args: ['--limit', '1']},
    {args: ['--limit', '5']}, {args: ['--limit', 'bad'], error: true},
  ]));
  await prepare(file, {out, integers: 'i64', casesFile});
  const implementation = `fn main() {
    let limit: i64 = std::env::args().nth(2).unwrap_or("3".into()).parse().unwrap();
    println!("entered");
    // Capture the original limit. The later Rank rebinding does not change it.
    let selected = || (1..=limit).map(|x| { println!("{}", x); x });
    let result = || selected().map(|x| x.checked_add(1).expect("overflow"));
    let quotient = || 12i64.checked_div(limit).expect("division by zero or overflow");
    let saved: Vec<i64> = result().collect();
    let sum = |items: Vec<i64>| items.into_iter().try_fold(0i64, |a, b| a.checked_add(b)).expect("overflow");
    println!("{}", sum(saved.clone()));
    println!("{}", sum(result().collect()));
    println!("{}", sum(saved));
    let argument: Vec<i64> = selected().collect();
    println!("{}", sum(argument.clone()).checked_add(sum(argument)).expect("overflow"));
    println!("{}", quotient());
}
`;
  await writeFile(join(out, 'src/main.rs'), implementation);
  const good = await verify(out);
  assert.equal(good.passed, 5);
  assert.equal(good.cases[0].expected.stdout, 'entered\n1\n2\n3\n9\n1\n2\n3\n9\n9\n1\n2\n3\n12\n4\n');
  assert.equal(good.cases[1].expected.stdout, 'entered\n0\n0\n0\n0\n');
  assert.equal(good.cases[1].expected.ok, false);
  // Same scalar totals, but caching Result suppresses observable replay effects.
  await writeFile(join(out, 'src/main.rs'), implementation.replace('sum(result().collect())', 'sum(saved.clone())'));
  const bad = await verify(out);
  assert.equal(bad.passed, 2); // Empty range and invalid CLI input still agree.
  assert.equal(bad.cases[0].actual.stdout, 'entered\n1\n2\n3\n9\n9\n9\n1\n2\n3\n12\n4\n');
});

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
