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

test('mouse reports split across chunks are clicks, not inserted text', () => {
    const keys = [], pastes = [], clicks = [];
    const decoder = new TerminalInputDecoder(text => keys.push(text), text => pastes.push(text),
        (column, row) => clicks.push([column, row]));
    decoder.write(Buffer.from('A\x1b['));
    for (const char of '<0;17;2M') decoder.write(Buffer.from(char));
    decoder.write(Buffer.from('\x1b[<0;17;2m\x1b[<64;17;2MB'));
    decoder.write(Buffer.from('\x1b[200~\x1b[<0;1;1M\x1b[201~'));
    assert.equal(keys.join(''), 'AB');
    assert.deepEqual(clicks, [[16, 1]]);
    assert.deepEqual(pastes, ['\x1b[<0;1;1M']);
});

test('wheel reports scroll in both directions without becoming keys or clicks', () => {
    const keys = [], scrolls = [], clicks = [];
    const decoder = new TerminalInputDecoder(text => keys.push(text), () => {},
        (...point) => clicks.push(point), direction => scrolls.push(direction));
    decoder.write(Buffer.from('A\x1b['));
    for (const char of '<64;10;3M') decoder.write(Buffer.from(char));
    decoder.write(Buffer.from('\x1b[<65;10;3M\x1b[<65;10;3mB'));
    assert.deepEqual(scrolls, [-1, 1]);
    assert.deepEqual(clicks, []);
    assert.equal(keys.join(''), 'AB');
});
