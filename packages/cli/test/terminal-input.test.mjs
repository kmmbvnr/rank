import assert from 'node:assert/strict';
import test from 'node:test';
import { TerminalInputDecoder } from '../out/terminal-input.js';

function setup() {
    const keys = [];
    const pastes = [];
    const decoder = new TerminalInputDecoder(text => keys.push(text), text => pastes.push(text));
    return { decoder, keys, pastes };
}

test('ordinary keys and a lone Esc are delivered immediately', () => {
    const { decoder, keys, pastes } = setup();
    decoder.write(Buffer.from('A\x1b'));
    assert.deepEqual(keys, ['A\x1b']);
    assert.deepEqual(pastes, []);
});

test('bracketed multiline paste is one value and surrounding keys remain keys', () => {
    const { decoder, keys, pastes } = setup();
    decoder.write(Buffer.from('A\x1b[200~X = 1\nY = 2\x1b[201~B'));
    assert.deepEqual(keys, ['A', 'B']);
    assert.deepEqual(pastes, ['X = 1\nY = 2']);
});

test('paste markers and UTF-8 characters can be split across chunks', () => {
    const { decoder, keys, pastes } = setup();
    decoder.write(Buffer.from('\x1b[20'));
    decoder.write(Buffer.from('0~'));
    for (const byte of Buffer.from('界🙂')) decoder.write(Buffer.from([byte]));
    decoder.write(Buffer.from('\x1b[20'));
    decoder.write(Buffer.from('1~'));
    assert.equal(keys.join(''), '');
    assert.deepEqual(pastes, ['界🙂']);
});

test('end flushes an unfinished ordinary sequence or paste', () => {
    const ordinary = setup();
    ordinary.decoder.write(Buffer.from('\x1b['));
    ordinary.decoder.end();
    assert.equal(ordinary.keys.join(''), '\x1b[');

    const pasted = setup();
    pasted.decoder.write(Buffer.from('\x1b[200~unfinished'));
    pasted.decoder.end();
    assert.deepEqual(pasted.pastes, ['unfinished']);
});
