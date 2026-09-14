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
