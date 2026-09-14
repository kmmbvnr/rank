import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorkerSession } from '../out/worker-session.js';

async function paused(session) {
    session.pause();
    for (let i = 0; i < 300 && !session.pauseState; i++) await delay(10);
    assert.ok(session.pauseState, 'worker did not pause');
    return session.pauseState;
}

test('factors pauses repeatedly with divisor and remainder, resumes and cancels', { timeout: 10000 }, async t => {
    const session = await createWorkerSession();
    t.after(() => session.dispose());
    await session.execute('use numbers', 0, []);
    await session.execute('N = 6342134340085145143324234234', 1, []);
    const execution = session.execute('N factors max', 2, []);
    await delay(40);
    const first = await paused(session);
    assert.equal(first.activity, 'searching factors');
    assert.ok(BigInt(first.details.divisor) >= 2n);
    assert.ok(BigInt(first.details.remaining) > 1n);
    assert.match(first.state, /N factors max/);
    assert.match(first.state, /N = 6342134340085145143324234234/);
    await delay(50);
    assert.equal(session.pauseState, first);
    session.resume();
    await delay(20);
    const second = await paused(session);
    assert.ok(BigInt(second.details.divisor) > BigInt(first.details.divisor));
    session.interrupt();
    assert.equal((await execution).interrupted, true);
    assert.equal(session.pauseState, undefined);
    assert.equal((await session.execute('21 * 2', 3, [])).ok, true);
});

test('disposing a paused worker wakes it and completes', { timeout: 10000 }, async () => {
    const session = await createWorkerSession();
    try {
        await session.execute('use numbers', 0, []);
        const execution = session.execute('6342134340085145143324234234 factors max', 1, []);
        await paused(session);
        await session.dispose();
        assert.equal((await execution).interrupted, true);
    } finally { await session.dispose(); }
});

test('paused nested calls expose locals and continue to the same result', { timeout: 15000 }, async t => {
    const session = await createWorkerSession();
    t.after(() => session.dispose());
    assert.equal((await session.execute(`fun inner N
  Total = 0
  for I in 1 to N
    Total = Total + I
  end
  return Total
end`, 0, [])).ok, true);
    assert.equal((await session.execute(`fun outer N
  Result = N inner
  return Result + 1
end`, 1, [])).ok, true);
    const execution = session.execute('1000000 outer', 2, []);
    await delay(40);
    const state = await paused(session);
    assert.match(state.state, /outer\ninner/);
    assert.match(state.state, /Total = [0-9]+/);
    assert.match(state.state, /N = 1000000/);
    session.resume();
    const result = await execution;
    assert.equal(result.ok, true, JSON.stringify(result.output));
    assert.ok(result.output.some(line => line.text.includes('500000500001')));
});

test('a lazy generator reports its frame without consuming it during inspection', { timeout: 10000 }, async t => {
    const session = await createWorkerSession();
    t.after(() => session.dispose());
    assert.equal((await session.execute(`fun items N
  Total = 0
  for I in 1 to N
    Total = Total + I
  end
  yield Total
end`, 0, [])).ok, true);
    const execution = session.execute('1000000 items sum', 1, []);
    await delay(30);
    const state = await paused(session);
    assert.match(state.state, /items/);
    assert.match(state.state, /N = 1000000/);
    session.resume();
    const result = await execution;
    assert.equal(result.ok, true, JSON.stringify(result.output));
    assert.ok(result.output.some(line => line.text.includes('500000500000')));
});

async function nextPause(session) {
    for (let i = 0; i < 300 && !session.pauseState; i++) await delay(10);
    assert.ok(session.pauseState, 'debugger did not stop');
    return session.pauseState;
}

test('step to main finishes a loop and preserves function breakpoints', { timeout: 10000 }, async t => {
    const session = await createWorkerSession();
    t.after(() => session.dispose());
    const fn = 'fun inc X\n  return X + 1\nend';
    await session.execute(fn, 0, []);
    session.setDebugBreakpoints([{ source: fn, line: 2 }]);
    const execution = session.execute('Total = 0\nfor I in 1 to 20\n  Total += I inc\nend\nTotal', 1, []);
    await nextPause(session);
    session.stepToMain();
    assert.equal((await nextPause(session)).line, 5);
    assert.match(session.pauseState.state, /Total = 230/);
    session.resume();
    assert.deepEqual((await execution).output.map(line => line.text), ['230']);
    const again = session.execute('41 inc', 2, []);
    assert.match((await nextPause(session)).state, /X = 41/);
    session.resume();
    assert.deepEqual((await again).output.map(line => line.text), ['42']);
});

test('step to main leaves ranked callbacks and stops in the following cell', { timeout: 10000 }, async t => {
    const session = await createWorkerSession();
    t.after(() => session.dispose());
    const fn = 'fun inc X\n  return X + 1\nend';
    await session.execute(fn, 0, []);
    session.setDebugBreakpoints([{ source: fn, line: 2 }]);
    const execution = session.execute('Total = ((1 to 20 array) inc rank 0) sum', 1, []);
    await nextPause(session);
    session.resume();
    await nextPause(session);
    session.stepToMain();
    assert.equal((await execution).ok, true);
    const next = session.execute('Answer = Total + 1', 2, []);
    const pause = await nextPause(session);
    assert.equal(pause.source, 'Answer = Total + 1');
    assert.equal(pause.line, 1);
    assert.match(pause.state, /Total = 230/);
    assert.doesNotMatch(pause.state, /  Answer =/);
    session.resume();
    assert.equal((await next).ok, true);
});

test('inspection does not evaluate a ranked array shape while paused inside its callback', { timeout: 10000 }, async t => {
    const session = await createWorkerSession();
    t.after(() => session.dispose());
    await session.execute('use text', 0, []);
    const fn = 'fun palindrome X\n  Text = X text\n  Back = Text reverse\n  return Text equal Back\nend';
    await session.execute(fn, 1, []);
    session.setDebugBreakpoints([{ source: fn, line: 2 }]);
    const execution = session.execute('Factors = 100 to 999\nProducts = Factors Factors * outer\nMask = Products palindrome rank 0', 2, []);
    const first = await nextPause(session);
    assert.match(first.state, /X = 10000/);
    assert.match(first.state, /Products = <array shape 900 × 900>/);
    assert.match(first.state, /Mask = <array shape not evaluated>/);
    assert.equal(first.state.split('\n').filter(line => line === 'palindrome').length, 1);
    session.step();
    assert.equal((await nextPause(session)).line, 3);
    assert.match(session.pauseState.state, /Text = "10000"/);
    session.step();
    assert.equal((await nextPause(session)).line, 4);
    assert.match(session.pauseState.state, /Back = "00001"/);
    session.interrupt();
    assert.equal((await execution).interrupted, true);
    session.setDebugBreakpoints([]);
    assert.deepEqual((await session.execute('121 palindrome', 3, [])).output.map(line => line.text), ['true']);
});

test('inspection shows globals once and orders current-line variables before recent reads', { timeout: 10000 }, async t => {
    const session = await createWorkerSession();
    t.after(() => session.dispose());
    const source = 'A = 1\nB = 2\nC = 3\nD = 4\nA\nB\nC + 0\n"D"';
    session.setDebugBreakpoints([{ source, line: 7 }, { source, line: 8 }]);
    const execution = session.execute(source, 0, []);
    const first = (await nextPause(session)).state;
    assert.doesNotMatch(first, /Globals:/);
    assert.deepEqual([...first.matchAll(/^  ([A-D]) =/gm)].map(match => match[1]), ['C', 'B', 'A', 'D']);
    session.resume();
    const second = (await nextPause(session)).state;
    // A string containing a name is not a reference to that variable.
    assert.deepEqual([...second.matchAll(/^  ([A-D]) =/gm)].map(match => match[1]), ['C', 'B', 'A', 'D']);
    session.resume();
    assert.equal((await execution).ok, true);
});

test('inspection lists each call frame once and preserves shadowed values', { timeout: 10000 }, async t => {
    const session = await createWorkerSession();
    t.after(() => session.dispose());
    await session.execute('N = 99', 0, []);
    const fn = 'fun inner N\n  A = 1\n  B = 2\n  A\n  B\n  return N + 0\nend';
    await session.execute(fn, 1, []);
    await session.execute('fun outer N\n  Result = (N + 1) inner\n  return Result\nend', 2, []);
    session.setDebugBreakpoints([{ source: fn, line: 6 }]);
    const execution = session.execute('10 outer', 3, []);
    const state = (await nextPause(session)).state;
    assert.match(state, /Variables \(current scope\):\n  N = 11\n  B = 2\n  A = 1/);
    assert.match(state, /outer locals:\n  N = 10/);
    assert.match(state, /Globals:\n  N = 99/);
    assert.doesNotMatch(state, /inner locals:/);
    assert.equal([...state.matchAll(/^  N =/gm)].length, 3);
    session.resume();
    assert.deepEqual((await execution).output.map(line => line.text), ['11']);
});

test('debug starts before first statement, steps lines and iterations, then finishes', { timeout: 10000 }, async t => {
    const session = await createWorkerSession();
    t.after(() => session.dispose());
    session.debugNext();
    const source = 'Total = 0\nfor I in 1 to 3\n  Total = Total + I\nend\nTotal';
    const execution = session.execute(source, 0, []);
    assert.equal((await nextPause(session)).line, 1);
    assert.doesNotMatch(session.pauseState.state, /  Total =/);
    session.step();
    assert.equal((await nextPause(session)).line, 2);
    session.step();
    assert.match((await nextPause(session)).state, /I = 1/);
    session.step();
    assert.equal((await nextPause(session)).line, 3);
    session.step(true);
    assert.match((await nextPause(session)).state, /I = 2/);
    assert.match(session.pauseState.state, /Total = 1/);
    session.step(true);
    assert.match((await nextPause(session)).state, /I = 3/);
    session.step(true);
    assert.equal((await nextPause(session)).line, 5);
    session.resume();
    assert.deepEqual((await execution).output.map(line => line.text), ['6']);
});

test('breakpoints stop repeated loop visits and can be removed before replay', { timeout: 10000 }, async t => {
    const session = await createWorkerSession();
    t.after(() => session.dispose());
    const source = 'Total = 0\nfor I in 1 to 2\n  Total = Total + I\nend\nTotal';
    session.setDebugBreakpoints([{ source, line: 3 }]);
    const execution = session.execute(source, 0, []);
    assert.match((await nextPause(session)).state, /I = 1/);
    session.resume();
    assert.match((await nextPause(session)).state, /I = 2/);
    session.resume();
    assert.equal((await execution).ok, true);
    session.setDebugBreakpoints([]);
    assert.equal((await session.execute(source, 1, [])).ok, true);
});

test('line step enters functions; iteration skips calls and nested loops', { timeout: 10000 }, async t => {
    const session = await createWorkerSession();
    t.after(() => session.dispose());
    const fn = 'fun inc N\n  return N + 1\nend';
    await session.execute(fn, 0, []);
    session.debugNext();
    const call = session.execute('1 inc', 1, []);
    await nextPause(session);
    session.step();
    assert.equal((await nextPause(session)).source, fn);
    assert.match(session.pauseState.state, /N = 1/);
    session.resume();
    assert.equal((await call).ok, true);
    const source = 'Total = 0\nfor I in 1 to 2\n  for J in 1 to 2\n    Total = Total inc\n  end\nend\nTotal';
    session.setDebugBreakpoints([{ source, line: 2 }]);
    const loop = session.execute(source, 2, []);
    await nextPause(session);
    session.step(true);
    assert.match((await nextPause(session)).state, /I = 1/);
    session.step(true);
    assert.match((await nextPause(session)).state, /I = 2/);
    assert.match(session.pauseState.state, /Total = 2/);
    session.step(true);
    assert.equal((await nextPause(session)).line, 7);
    session.resume();
    assert.deepEqual((await loop).output.map(line => line.text), ['4']);
});

test('conditional loop steps inspect its state and cancellation runs finally without stopping again', { timeout: 10000 }, async t => {
    const session = await createWorkerSession();
    t.after(() => session.dispose());
    const source = 'N = 0\ntry\n  for N less 3\n    N += 1\n  end\nfinally\n  N += 10\nend';
    session.setDebugBreakpoints([{ source, line: 4 }, { source, line: 7 }]);
    const execution = session.execute(source, 0, []);
    assert.match((await nextPause(session)).state, /N = 0/);
    session.step(true);
    assert.equal((await nextPause(session)).line, 3);
    assert.match(session.pauseState.state, /N = 1/);
    session.interrupt();
    assert.equal((await execution).interrupted, true);
    assert.deepEqual((await session.execute('N', 1, [])).output.map(line => line.text), ['11']);
});

test('source stepping resumes a lazy generator without skipping yields', { timeout: 10000 }, async t => {
    const session = await createWorkerSession();
    t.after(() => session.dispose());
    const source = 'fun items N\n  for I in 1 to N\n    yield I\n  end\nend';
    await session.execute(source, 0, []);
    session.setDebugBreakpoints([{ source, line: 3 }]);
    const execution = session.execute('2 items sum', 1, []);
    assert.match((await nextPause(session)).state, /I = 1/);
    session.step(true);
    assert.equal((await nextPause(session)).line, 2);
    assert.match(session.pauseState.state, /I = 2/);
    session.resume();
    assert.equal((await nextPause(session)).line, 3);
    session.resume();
    assert.deepEqual((await execution).output.map(line => line.text), ['3']);
});
