import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { Interpreter, formatValue } from '@arrrank/interpreter';
import { SequenceReplay } from '../out/sequence-replay.js';
import { preview } from '../out/preview.js';

const definition = `use sequences
fun nums N
  yield N
  yield N + 1
  yield N + 2
end`;

test('nullary generator calls create fresh tapes and saved instances rewind', t => {
    const s = session(t);
    s.interpreter.execute('fun tst\n yield 1\n yield 2\n yield 3\nend');
    const g = s.run(1, 'G = tst');
    assert.equal(s.look(g).text, '1 2 3');
    assert.equal(formatValue(s.run(2, 'G array')), '1 2 3');
    assert.throws(() => s.run(3, 'G array'), /already been consumed/);
    s.replay.rewind(2);
    assert.equal(formatValue(s.run(2, 'G array')), '1 2 3');
    assert.equal(formatValue(s.run(3, 'tst array')), '1 2 3');
    assert.equal(formatValue(s.run(4, 'tst array')), '1 2 3');
});

function session(t, options = {}) {
    const replay = new SequenceReplay();
    const output = [];
    const interpreter = new Interpreter(line => output.push(line), {
        persistentResources: true, wrapSinglePassSequence: replay.wrap, wrapStoredSequence: replay.store, ...options,
    });
    t.after(() => { try { replay.dispose(); } finally { interpreter.dispose(); } });
    interpreter.execute(definition);
    return {
        replay, interpreter, output,
        run(line, source) { replay.atLine(line); return interpreter.execute(source); },
        look(value) { return replay.preview(() => preview(value)); },
    };
}

test('looking repeatedly does not consume a generator, including assignment and full', t => {
    const s = session(t);
    const g = s.run(1, 'G = 3 nums');
    assert.deepEqual(s.look(g), { text: '3 4 5', note: '' });
    assert.equal(s.look(g).text, '3 4 5');
    assert.equal(s.replay.preview(() => formatValue(g)), '3 4 5');
    assert.equal(formatValue(s.run(2, 'G array')), '3 4 5');
    assert.throws(() => s.run(3, 'G array'), /already been consumed/);
    assert.deepEqual(s.look(g), { text: '', note: '' });
});

test('preview and full show the unread tail without consuming it, and rewind restores the start', t => {
    const s = session(t);
    const g = s.run(1, 'G = 3 nums');
    assert.equal(s.look(g).text, '3 4 5');
    assert.equal(s.run(2, 'G 0'), 3n);
    assert.equal(s.look(g).text, '4 5');
    assert.equal(s.look(g).text, '4 5');
    assert.equal(s.replay.preview(() => formatValue(g)), '4 5');
    s.replay.rewind(2);
    assert.equal(s.look(g).text, '3 4 5');
    s.run(2, 'G array');
    assert.deepEqual(s.look(g), { text: '', note: '' });
    assert.equal(s.replay.preview(() => formatValue(g)), '');
});

test('an unread tail can be previewed before it is cached, through either alias', t => {
    const s = session(t);
    const g = s.run(1, 'G = 3 nums');
    const h = s.run(2, 'H = G');
    assert.equal(s.run(3, 'G 0'), 3n);
    assert.equal(s.look(h).text, '4 5');
    assert.equal(s.look(g).text, '4 5');
    s.replay.rewind(3);
    assert.equal(formatValue(s.run(3, 'H array')), '3 4 5');
    assert.equal(s.look(g).text, '');
});

test('cached outer reads restore the actual consumed position of inner generators', t => {
    const s = session(t);
    s.interpreter.execute('fun forward G\n  for V in G\n    yield V\n  end\nend');
    const g = s.run(1, 'G = 3 nums');
    const h = s.run(2, 'H = G forward');
    assert.equal(s.look(h).text, '3 4 5');
    assert.equal(s.run(3, 'H 0'), 3n);
    assert.equal(s.look(g).text, '4 5');
    assert.equal(s.look(h).text, '4 5');
    s.replay.rewind(3);
    assert.equal(s.look(g).text, '3 4 5');
    assert.equal(formatValue(s.run(3, 'H array')), '3 4 5');
    assert.deepEqual(s.look(g), { text: '', note: '' });
    assert.deepEqual(s.look(h), { text: '', note: '' });
});

test('rewinding resets only consumption on or below the target line', t => {
    const s = session(t);
    s.run(1, 'G = 3 nums\nH = 6 nums');
    s.run(2, 'G array');
    s.run(4, 'H array');
    s.replay.rewind(3);
    assert.throws(() => s.run(3, 'G array'), /already been consumed/);
    assert.equal(formatValue(s.run(4, 'H array')), '6 7 8');
    s.replay.rewind(2);
    assert.equal(formatValue(s.run(2, 'G array')), '3 4 5');
});

test('aliases and two reads inside one statement still share consumption', t => {
    const s = session(t);
    s.run(1, 'G = 3 nums\nH = G');
    s.run(2, 'G array');
    assert.throws(() => s.run(3, 'H array'), /already been consumed/);
    s.replay.rewind(2);
    assert.throws(() => s.run(2, 'A = G array\nB = H array'), /already been consumed/);
});

test('an abandoned read can replay and then request more without repeating effects', t => {
    const s = session(t);
    s.interpreter.execute(`use io
fun logged N
  N print
  yield N
  (N + 1) print
  yield N + 1
end`);
    s.run(1, 'G = 3 logged');
    assert.equal(s.run(2, 'G 0'), 3n);
    assert.deepEqual(s.output, ['3']);
    s.replay.rewind(2);
    assert.equal(formatValue(s.run(2, 'G array')), '3 4');
    assert.deepEqual(s.output, ['3', '4']);
    s.replay.rewind(2);
    assert.equal(formatValue(s.run(2, 'G array')), '3 4');
    assert.deepEqual(s.output, ['3', '4']);
});

test('preview of an endless generator pulls a bounded head and retains it', t => {
    const s = session(t);
    s.interpreter.execute(`use io
fun forever N
  for true
    N print
    yield N
    N += 1
  end
end`);
    const g = s.run(1, 'G = 0 forever');
    assert.deepEqual(s.look(g), { text: '0 1 2 3 4 5 6 7 8 9 ...', note: 'size unknown' });
    assert.equal(s.output.length, 10);
    assert.equal(s.run(2, 'G 12'), 12n);
    s.replay.rewind(2);
    assert.equal(s.run(2, 'G 20'), 20n);
    assert.deepEqual(s.output, Array.from({ length: 21 }, (_, index) => String(index)));
});

test('generator masks and explicit selection use the source tape', t => {
    const s = session(t);
    const mask = s.run(1, 'G = 3 nums\nM = G greater 3');
    assert.equal(s.look(mask).text, 'false true true');
    assert.equal(formatValue(s.run(2, 'M array')), 'false true true');
    s.replay.rewind(2);
    assert.equal(formatValue(s.run(2, 'G M array')), '4 5');
    s.replay.rewind(2);
    assert.equal(formatValue(s.run(2, 'G array')), '3 4 5');
});

test('cached outer generators also restore consumption of their dependencies', t => {
    const s = session(t);
    s.interpreter.execute(`fun forward G
  for V in G
    yield V
  end
end`);
    const h = s.run(1, 'G = 3 nums\nH = G forward');
    assert.equal(s.look(h).text, '3 4 5');
    s.run(2, 'H array');
    assert.throws(() => s.run(3, 'G array'), /already been consumed/);
    s.replay.rewind(2);
    s.run(2, 'H array');
    assert.throws(() => s.run(3, 'G array'), /already been consumed/);
});

test('a generator error is replayed at the same position without rerunning its body', t => {
    const s = session(t);
    s.interpreter.execute(`use io
fun broken N
  N print
  yield N
  yield 1 // 0
end`);
    s.run(1, 'G = 3 broken');
    assert.throws(() => s.run(2, 'G array'), /division by zero/);
    s.replay.rewind(2);
    assert.throws(() => s.run(2, 'G array'), /division by zero/);
    assert.deepEqual(s.output, ['3']);
});

test('session disposal finishes suspended generator finally blocks', t => {
    const s = session(t);
    s.interpreter.execute(`use io
fun held N
  try
    yield N
    yield N + 1
  finally
    "closed" print
  end
end`);
    s.run(1, 'G = 3 held');
    s.run(2, 'G 0');
    assert.deepEqual(s.output, []);
    s.replay.dispose();
    assert.deepEqual(s.output, ['closed']);
});

test('session disposal closes files held by a suspended generator', t => {
    let closed = false;
    const s = session(t, { io: { open: () => ({ name: '/input', close() { closed = true; } }) } });
    s.interpreter.execute(`use io
fun opened N
  File = "/input" open
  yield N
  yield N + 1
end`);
    s.run(1, 'G = 3 opened');
    s.run(2, 'G 0');
    assert.equal(closed, false);
    s.replay.dispose();
    assert.equal(closed, true);
});

test('stdin sequences replay buffered input without reading the port twice', t => {
    const tokens = ['3', '4'];
    const s = session(t, { input: { readToken: () => tokens.shift() } });
    const g = s.run(1, 'use io\nG = stdin .integer 2');
    assert.equal(s.look(g).text, '3 4');
    assert.equal(formatValue(s.run(2, 'G array')), '3 4');
    s.replay.rewind(2);
    assert.equal(formatValue(s.run(2, 'G array')), '3 4');
    assert.equal(tokens.length, 0);
});

test('recreating a generator produces a fresh tape', t => {
    const s = session(t);
    s.run(1, 'G = 3 nums');
    s.run(2, 'G array');
    s.replay.rewind(1);
    s.run(1, 'G = 8 nums');
    assert.equal(formatValue(s.run(2, 'G array')), '8 9 10');
});

test('imported generator functions also use the session tape', t => {
    const s = session(t, { loadModule: () => ({ id: '/nums.ra', source: definition }) });
    const g = s.run(1, 'use "nums.ra" as Lib\nG = 3 Lib.nums');
    assert.equal(s.look(g).text, '3 4 5');
    assert.equal(formatValue(s.run(2, 'G array')), '3 4 5');
    s.replay.rewind(2);
    assert.equal(formatValue(s.run(2, 'G array')), '3 4 5');
});

test('ordinary execution still consumes once and closes an abandoned generator', () => {
    const output = [];
    const interpreter = new Interpreter(line => output.push(line));
    try {
        interpreter.execute(`${definition}
use io
fun held N
  try
    yield N
  finally
    "closed" print
  end
end
G = 3 held`);
        assert.equal(interpreter.execute('G 0'), 3n);
        assert.deepEqual(output, ['closed']);
        assert.throws(() => interpreter.execute('G array'), /already been consumed/);
    } finally { interpreter.dispose(); }
});

test('the actual CLI previews assignment, a name and full without spending the generator', () => {
    const result = spawnSync(process.execPath, ['packages/cli/bin/cli.js'], {
        cwd: new URL('../../../', import.meta.url), encoding: 'utf8',
        input: `${definition}\nG = 3 nums\nG\nfull\nG array\nexit\n`,
    });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.split('3 4 5').length - 1, 4);
});

test('an error beyond the preview head is reported by full without exiting the CLI', () => {
    const source = `fun late N
  for true
    yield N
    N += 1
    if N equal 12
      yield 1 // 0
    end
  end
end
G = 0 late
full
12345
exit
`;
    const result = spawnSync(process.execPath, ['packages/cli/bin/cli.js'], {
        cwd: new URL('../../../', import.meta.url), encoding: 'utf8', input: source,
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /size unknown/);
    assert.match(result.stderr, /division by zero/);
    assert.match(result.stdout, /12345\n/);
});

test('stored primes resume after bounded sums and preserve the first excluded value', t => {
    const s = session(t);
    const g = s.run(1, 'G = primes');
    assert.match(s.look(g).text, /^2 3 5 7/);
    assert.match(s.look(s.run(2, 'G until 100')).text, /^2 3 5 7/);
    assert.match(s.look(g).text, /^2 3 5 7/);
    assert.equal(s.run(3, 'G until 100 sum'), 1060n);
    assert.match(s.look(g).text, /^101 103 107/);
    assert.equal(s.run(4, 'G until 120 sum'), 533n);
    assert.match(s.look(g).text, /^127 131 137/);
    s.replay.rewind(4);
    assert.match(s.look(g).text, /^101 103 107/);
    assert.equal(s.run(4, 'G until 120 sum'), 533n);
    s.replay.rewind(3);
    assert.match(s.look(g).text, /^2 3 5 7/);
});

test('stored sources start fresh while aliases share the same cursor', t => {
    const s = session(t);
    const g = s.run(1, 'G = primes');
    const h = s.run(2, 'H = G');
    assert.equal(s.run(3, 'G until 10 sum'), 17n);
    assert.match(s.look(h).text, /^11 13 17/);
    assert.equal(s.run(4, 'H 0'), 11n);
    assert.match(s.look(g).text, /^13 17 19/);
    const fresh = s.run(5, 'F = primes');
    assert.match(s.look(fresh).text, /^2 3 5/);
    assert.equal(s.run(6, 'F until 10 sum'), 17n);
    assert.match(s.look(g).text, /^13 17 19/);
});

test('inclusive, empty and lower bounds consume only the requested prefix', t => {
    const s = session(t);
    const g = s.run(1, 'G = primes');
    assert.equal(s.run(2, 'G until 2 sum'), 0n);
    assert.equal(s.run(3, 'G to 2 sum'), 2n);
    assert.match(s.look(g).text, /^3 5 7/);
    assert.equal(s.run(4, '(G from 10) until 20 sum'), 60n);
    assert.match(s.look(g).text, /^23 29 31/);
    const limited = s.run(5, 'Limited = G until 30');
    assert.equal(s.run(6, 'Limited until 100 sum'), 52n);
    assert.match(s.look(g).text, /^31 37 41/);
    assert.equal(s.look(limited).text, '');
});

test('Fibonacci reductions and combined masks read the stream rather than a fresh plan', t => {
    const s = session(t);
    s.run(1, 'use numbers\nG = fibonacci');
    assert.equal(s.run(2, 'G until 10 sum'), 19n);
    assert.equal(s.run(3, 'G until 30 sum'), 34n);
    assert.match(s.look(s.interpreter.variables.get('G')).text, /^34 55 89/);
    s.run(4, 'P = primes\nMask = P greater 5 and P less 20');
    assert.equal(s.run(5, 'P Mask until 20 sum'), 67n);
    assert.match(s.look(s.interpreter.variables.get('P')).text, /^23 29 31/);
});

test('filtered views retain their stream source when assigned and bounded again', t => {
    const s = session(t);
    const g = s.run(1, 'G = primes');
    s.run(2, 'H = (G (G greater 5)) until 100');
    assert.equal(s.run(3, 'H until 20 sum'), 67n);
    assert.match(s.look(g).text, /^23 29 31/);
    assert.equal(s.run(4, 'H until 30 sum'), 52n);
    assert.match(s.look(g).text, /^31 37 41/);
});

test('cached generators cannot move a separately consumed native source backwards', t => {
    const s = session(t);
    s.run(1, 'fun forward G\n for V in G until 1000\n  yield V\n end\nend\nG = primes\nH = G forward');
    s.look(s.interpreter.variables.get('H'));
    s.run(2, 'G until 100 sum');
    assert.throws(() => s.run(3, 'H 0'), /advanced since this value was buffered/);
    assert.match(s.look(s.interpreter.variables.get('G')).text, /^101 103 107/);
    s.replay.rewind(2);
    assert.equal(s.run(2, 'H 0'), 2n);
    assert.match(s.look(s.interpreter.variables.get('G')).text, /^3 5 7/);
});

test('ordinary execution keeps reusable native sequences and ranges', () => {
    const interpreter = new Interpreter(() => {});
    interpreter.execute('use sequences\nG = primes');
    assert.equal(interpreter.execute('G until 100 sum'), 1060n);
    assert.equal(interpreter.execute('G until 100 sum'), 1060n);
});

test('two sequential reads and nested readers share a native cursor without duplication', t => {
    const s = session(t);
    s.run(1, 'G = primes');
    assert.equal(s.run(2, '(G 0) + (G 0)'), 5n);
    assert.equal(s.run(3, 'Total = 0\nfor P in G until 11\n Total += P\n Extra = G 0\n Total += Extra\nend\nTotal'), 12n);
    assert.match(s.look(s.interpreter.variables.get('G')).text, /^11 13 17/);
});

test('previewing two readers of one native stream mirrors consumption without spending it', t => {
    const s = session(t);
    const g = s.run(1, 'G = primes');
    s.run(2, 'H = G until 10');
    const pairs = s.run(3, 'H + H');
    assert.equal(s.look(pairs).text, '5 12');
    assert.match(s.look(g).text, /^2 3 5/);
    assert.equal(formatValue(s.run(4, '(H + H) array')), '5 12');
    assert.match(s.look(g).text, /^11 13 17/);
});

test('the actual CLI shows 101 after consuming primes below 100', () => {
    const result = spawnSync(process.execPath, ['packages/cli/bin/cli.js'], {
        cwd: new URL('../../../', import.meta.url), encoding: 'utf8',
        input: 'use sequences\nG = primes\nG until 100\nG until 100 sum\nG\nexit\n',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /1060\n/);
    assert.match(result.stdout, /101 103 107/);
});
