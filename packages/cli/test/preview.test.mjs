import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Interpreter } from '@arrrank/interpreter';
import { preview, PREVIEW_ITEMS } from '../out/preview.js';
import { createReplSession } from '../out/repl-session.js';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

function value(source) {
    const interpreter = new Interpreter(() => undefined);
    try {
        return interpreter.execute(source);
    } finally {
        interpreter.dispose();
    }
}

test('a short value is shown whole', () => {
    assert.deepEqual(preview(value('1 to 6')), { text: '1 2 3 4 5 6', note: '' });
    assert.deepEqual(preview(value('array 1 2 3')), { text: '1 2 3', note: '' });
    assert.deepEqual(preview(value('"short"')), { text: 'short', note: '' });
});

test('a long sequence keeps both ends and counts the rest', () => {
    const shown = preview(value('1 until 1000'));
    assert.match(shown.text, /^1 2 3 4 5 6 7 8 9 10 \.\.\. 99[0-9]/);
    assert.match(shown.text, /999$/);
    assert.equal(shown.note, '999 values');
    assert.equal(shown.text.split(' ').length, PREVIEW_ITEMS + 1);
});

test('a long array keeps both ends', () => {
    const shown = preview(value('use sequences\n(1 until 1000) array'));
    assert.match(shown.text, /^1 2 3 .* 998 999$/);
    assert.equal(shown.note, '999 values');
});

test('an unbounded sequence shows a beginning only', () => {
    const shown = preview(value('use sequences\nprimes'));
    assert.equal(shown.text, '2 3 5 7 11 13 17 19 23 29 ...');
    assert.equal(shown.note, 'unbounded');
});

test('a tensor reports the shape its flat text hides', () => {
    const shown = preview(value('array shape 3 4 fill 7'));
    assert.equal(shown.text, '7 7 7 7 7 7 7 7 7 7 7 7');
    assert.equal(shown.note, 'shape 3 4');
});

test('long text is cut and counted', () => {
    const shown = preview(value([
        'use sequences', 'use text',
        'A = (1 until 200) array',
        'A "," join',
    ].join('\n')));
    assert.match(shown.text, / \.\.\.$/);
    assert.match(shown.note, /^\d+ characters$/);
    assert.ok(shown.text.length < 260, `kept ${shown.text.length} characters`);
});

test('a result is cut to the width of the screen', () => {
    const fib = value('use cli\nuse sequences\nfibonacci to 400000');
    const narrow = preview(fib, 40);
    assert.ok(narrow.text.length <= 40, narrow.text);
    assert.match(narrow.text, /^1 2 3 .* \.\.\. .*317811$/);
    assert.equal(narrow.note, '27 values');
    // A wider screen keeps more of the same two ends.
    const wide = preview(fib, 80);
    assert.ok(wide.text.length <= 80, wide.text);
    assert.ok(wide.text.length > narrow.text.length);
    // A value that already fits is not cut, and one the width cuts says how
    // much of it there was.
    assert.deepEqual(preview(value('array 1 2 3'), 40), { text: '1 2 3', note: '' });
    const short = preview(value('1 to 12'), 20);
    assert.ok(short.text.length <= 20, short.text);
    assert.equal(short.note, '12 values');
});

test('the REPL cuts a result and full prints it whole', () => {
    const session = spawnSync(process.execPath, [cli], {
        encoding: 'utf8',
        input: '1 until 1000\nfull\nexit\n',
    });
    assert.equal(session.status, 0);
    const first = session.stdout.split('\n')[0];
    assert.ok(first.length <= 40, first);
    assert.match(first, /^1 2 3 .* \.\.\. .*999$/);
    assert.match(session.stdout, /999 values/);
    // The whole value has every number in it, cut nowhere.
    assert.match(session.stdout, /499 500 501/);
    assert.doesNotMatch(session.stdout.split('999 values')[1], /\.\.\./);
});

test('REPL previews cap numeric sequences and boolean masks at 40 columns, even in a wide terminal', async t => {
    for (const columns of [120, 80, 47, 30]) {
        const session = createReplSession();
        t.after(() => session.dispose());
        const sources = ['use numbers', 'N = 1 until 1000', 'Mask = N multiple by 3', 'Mask or= N multiple by 5'];
        for (const [index, source] of sources.entries()) {
            const result = await session.execute(source, index, [], columns);
            assert.equal(result.ok, true);
            if (!index) continue;
            const [values, count] = result.output.map(line => line.text);
            assert.ok(values.length <= Math.min(40, columns - 7), values);
            assert.match(values, /\.\.\./);
            assert.equal(count, '999 values');
            if (index === 1) assert.match(values, /^1 .*999$/);
            else assert.match(values, /^false .*true$/);
        }
    }
});
