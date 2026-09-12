import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Interpreter } from 'rank-interpreter';
import { preview, PREVIEW_ITEMS } from '../out/preview.js';

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
    assert.deepEqual(preview(value('use ranges\n1 to 6')), { text: '1 2 3 4 5 6', note: '' });
    assert.deepEqual(preview(value('array 1 2 3')), { text: '1 2 3', note: '' });
    assert.deepEqual(preview(value('"short"')), { text: 'short', note: '' });
});

test('a long sequence keeps both ends and counts the rest', () => {
    const shown = preview(value('use ranges\n1 until 1000'));
    assert.match(shown.text, /^1 2 3 4 5 6 7 8 9 10 \.\.\. 99[0-9]/);
    assert.match(shown.text, /999$/);
    assert.equal(shown.note, '999 values');
    assert.equal(shown.text.split(' ').length, PREVIEW_ITEMS + 1);
});

test('a long array keeps both ends', () => {
    const shown = preview(value('use ranges\nuse sequences\n(1 until 1000) array'));
    assert.match(shown.text, /^1 2 3 .* 998 999$/);
    assert.equal(shown.note, '999 values');
});

test('an unbounded sequence shows a beginning only', () => {
    const shown = preview(value('use sequences\nprimes'));
    assert.equal(shown.text, '2 3 5 7 11 13 17 19 23 29 ...');
    assert.equal(shown.note, 'unbounded');
});

test('a tensor reports the shape its flat text hides', () => {
    const shown = preview(value('array shape 3 4 pad 7'));
    assert.equal(shown.text, '7 7 7 7 7 7 7 7 7 7 7 7');
    assert.equal(shown.note, 'shape 3 4');
});

test('long text is cut and counted', () => {
    const shown = preview(value([
        'use ranges', 'use sequences', 'use text',
        'A = (1 until 200) array',
        'A "," join',
    ].join('\n')));
    assert.match(shown.text, / \.\.\.$/);
    assert.match(shown.note, /^\d+ characters$/);
    assert.ok(shown.text.length < 260, `kept ${shown.text.length} characters`);
});

test('the REPL cuts a result and full prints it whole', () => {
    const session = spawnSync(process.execPath, [cli], {
        encoding: 'utf8',
        input: 'use ranges\n1 until 1000\nfull\nexit\n',
    });
    assert.equal(session.status, 0);
    assert.match(session.stdout, /1 2 3 4 5 6 7 8 9 10 \.\.\. 99/);
    assert.match(session.stdout, /999 values/);
    // The whole value has every number in it, cut nowhere.
    assert.match(session.stdout, /499 500 501/);
    assert.doesNotMatch(session.stdout.split('999 values')[1], /\.\.\./);
});
