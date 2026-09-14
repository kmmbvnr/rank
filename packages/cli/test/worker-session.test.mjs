import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerSession } from '../out/worker-session.js';
import { NotebookRepl } from '../out/repl.js';

async function session(t) {
    const value = await createWorkerSession();
    t.after(() => value.dispose());
    return value;
}

async function stop(session, source, id = 2) {
    const pending = session.execute(source, id, []);
    const timer = setTimeout(() => session.interrupt(), 150);
    try { return await pending; }
    finally { clearTimeout(timer); }
}

test('factor search cancels without losing bindings, and can be cancelled again', { timeout: 10000 }, async t => {
    const s = await session(t);
    await s.execute('use numbers', 0, []);
    await s.execute('A = 41', 1, []);
    const result = await stop(s, 'Factors = 170141183460469231731687303715884105727 factors');
    assert.equal(result.interrupted, true);
    assert.equal(result.ok, false);
    assert.match(result.output.map(x => x.text).join('\n'), /searching factors/);
    const next = await s.execute('A + 1', 3, []);
    assert.equal(next.ok, true);
    assert.equal(next.output[0].text, '42');
    const again = await stop(s, 'Factors max', 4);
    assert.equal(again.interrupted, true);
    assert.match(again.output.map(x => x.text).join('\n'), /Factors max/);
    assert.equal((await s.execute('2 + 3', 5, [])).output[0].text, '5');
});

test('compiled endless loop cancels, bypasses catch, and runs finally', { timeout: 10000 }, async t => {
    const s = await session(t);
    const result = await stop(s, 'try\n  for\n    A = 1\n  end\ncatch E\n  Caught = true\nfinally\n  Cleaned = 7\nend');
    assert.equal(result.interrupted, true);
    assert.equal((await s.execute('Cleaned', 3, [])).output[0].text, '7');
    assert.equal((await s.execute('Caught', 4, [])).ok, false);
});

test('notebook returns to prompt and stops the queued suffix on cancellation', { timeout: 10000 }, async t => {
    const s = await session(t);
    const repl = new NotebookRepl(s);
    repl.notebook.enqueue('for\n  A = 1\nend');
    repl.notebook.enqueue('B = 99');
    const pending = repl.submit(true);
    const timer = setTimeout(() => repl.interrupt(), 150);
    try { await pending; } finally { clearTimeout(timer); }
    assert.equal(repl.running, false);
    assert.equal(repl.notebook.atPrompt, true);
    assert.equal(repl.notebook.cells[0].status, 'interrupted');
    assert.equal(repl.notebook.cells[1].status, 'idle');
    assert.equal((await s.execute('B', 4, [])).ok, false);
});

test('worker keeps editing metadata and file state in sync', { timeout: 10000 }, async t => {
    const s = await session(t);
    await s.execute('use numbers', 0, []);
    assert.ok(s.complete('fac')[0].includes('factors '));
    await s.execute('alias off', 1, []);
    assert.equal(s.format('A plus B'), 'A plus B');
    await s.execute('fun help\n  return 3\nend', 2, []);
    assert.equal(s.isCommand('help'), false);
    s.replaceFile({ path: '/tmp/example.ra', source: 'A = 8' });
    assert.equal(s.isCommand('help'), true);
    assert.equal(s.savedFile.source, 'A = 8\n');
    assert.equal((await s.execute('A = 8', 0, [], 80, true)).ok, true);
    assert.equal(s.isCommand('help'), true);
    assert.equal(s.savedFile.source, 'A = 8\n');
});

test('empty loop and a native sequence can both be stopped', { timeout: 10000 }, async t => {
    const s = await session(t);
    assert.equal((await stop(s, 'for\nend')).interrupted, true);
    await s.execute('use sequences\nuse numbers', 3, []);
    const result = await stop(s, 'primes until 170141183460469231731687303715884105727 sum', 4);
    assert.equal(result.interrupted, true);
    assert.equal((await s.execute('9', 5, [])).output[0].text, '9');
});

test('full can be stopped and Ctrl-R can retry a stopped cell after editing', { timeout: 10000 }, async t => {
    const s = await session(t);
    await s.execute('use numbers', 0, []);
    await stop(s, 'Factors = 170141183460469231731687303715884105727 factors', 1);
    assert.equal((await stop(s, 'full', 2)).interrupted, true);
    const repl = new NotebookRepl(s);
    repl.notebook.replace('for\nend');
    const pending = repl.submit();
    const timer = setTimeout(() => repl.interrupt(), 150);
    try { await pending; } finally { clearTimeout(timer); }
    repl.notebook.active = 0;
    repl.notebook.replace('7');
    await repl.submit(true);
    assert.equal(repl.notebook.cells[0].status, 'ok');
    assert.equal(repl.notebook.cells[0].output[0].text, '7');
});

test('a cancelled generator reports its closed state instead of replaying Ctrl-C', { timeout: 10000 }, async t => {
    const s = await session(t);
    await s.execute('fun generate\n  yield 1\n  for\n  end\nend', 0, []);
    assert.equal((await stop(s, 'G = generate', 1)).interrupted, true);
    const again = await s.execute('G', 2, []);
    assert.equal(again.interrupted, false);
    assert.equal(again.ok, false);
    assert.match(again.output.map(x => x.text).join('\n'), /rerun its producing cell/);
});

test('large native binomial and matrix elimination cancel while the terminal thread stays responsive', { timeout: 10000 }, async t => {
    const s = await session(t);
    await s.execute('use numbers\nuse linalg', 0, []);
    const binomial = await stop(s, '1000000 500000 binomial', 1);
    assert.equal(binomial.interrupted, true);
    assert.match(binomial.output.map(x => x.text).join('\n'), /computing binomial/);
    const cached = await stop(s, '10000000 2 1000000007 binomialmod', 2);
    assert.equal(cached.interrupted, true);
    assert.equal((await s.execute('2000 2 1000000007 binomialmod', 2, [])).output[0].text, '1999000');
    const matrix = await s.execute('Matrix = ((1 to 500) array) diag', 2, []);
    assert.equal(matrix.ok, true, JSON.stringify(matrix.output));
    const det = await stop(s, 'Matrix det', 3);
    assert.equal(det.interrupted, true);
    assert.match(det.output.map(x => x.text).join('\n'), /linear algebra/);
    assert.equal((await s.execute('Matrix 0 0', 4, [])).output[0].text, '1');
    assert.equal((await s.execute('30 2 binomial', 5, [])).output[0].text, '435');
});
