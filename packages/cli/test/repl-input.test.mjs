import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
    EMPTY_CELL, addLine, cellSource, closeCell, expandCompoundKeywords, expandOperators,
    isComplete, isEmpty, nextIndent, promptFor, scanLine, tokenize,
} from '../out/repl-input.js';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const unbound = () => false;

function cell(...lines) {
    return lines.reduce((state, line) => addLine(state, line), EMPTY_CELL);
}

function expand(line, isBound = unbound) {
    return expandOperators(expandCompoundKeywords(line, isBound), isBound);
}

test('tokenizes the pieces an input rule depends on', () => {
    assert.deepEqual(tokenize('A gets 1.5').map(item => item.kind),
        ['variable', 'word', 'number']);
    assert.deepEqual(tokenize('Mod.name').map(item => item.kind), ['qualified']);
    assert.deepEqual(tokenize('A rem gets 2').map(item => item.kind), ['variable', 'comment']);
    assert.equal(tokenize('"open').at(-1).closed, false);
    assert.equal(tokenize('"shut"').at(-1).closed, true);
    assert.deepEqual(tokenize('A **= 2').map(item => item.text), ['A', '**=', '2']);
});

test('expands alias words only in operator position', () => {
    assert.equal(expand('A gets 3'), 'A = 3');
    assert.equal(expand('A gets B plus C times D'), 'A = B + C * D');
    assert.equal(expand('A gets 7 mod 4 power 2'), 'A = 7 % 4 ** 2');
    assert.equal(expand('A times gets 2'), 'A *= 2');
    assert.equal(expand('A and gets B'), 'A and= B');
    assert.equal(expand('M every 2'), 'M # 2');
    // A line may not start with an operator, so the word stays a name.
    assert.equal(expand('gets 3'), 'gets 3');
    // The session owns the name.
    assert.equal(expand('A times 2', name => name === 'times'), 'A times 2');
    // Strings and comments are never rewritten.
    assert.equal(expand('A gets "1 plus 2"'), 'A = "1 plus 2"');
    assert.equal(expand('A rem gets 2'), 'A rem gets 2');
});

test('folds a line that cannot end a statement', () => {
    assert.equal(scanLine('A = 1 +').folds, true);
    assert.equal(scanLine('A = B and').folds, true);
    assert.equal(scanLine('A = (').folds, true);
    assert.equal(scanLine('A = 1 + 2').folds, false);
    // array, shape and index are reference names, so they can end a line.
    assert.equal(scanLine('1 to 5 array').folds, false);
    assert.equal(scanLine('A shape').folds, false);
    assert.equal(scanLine('for').folds, false);

    const state = cell('A = 1 +', '2 +', '3');
    assert.equal(cellSource(state), 'A = 1 + 2 + 3');
    assert.equal(isComplete(state), true);
});

test('closes a quote and a bracket at the end of the line', () => {
    assert.equal(cellSource(cell('A = "text')), 'A = "text"');
    assert.equal(cellSource(cell('A = (1 + 2')), 'A = (1 + 2)');
    assert.equal(cellSource(cell('A = ((1 + 2) * (3')), 'A = ((1 + 2) * (3))');
    assert.equal(cellSource(cell('A = ("text')), 'A = ("text")');
});

test('tracks blocks and re-indents every line', () => {
    const state = cell('for i in 1 to 3', 'if i greater 1', 'i print', 'else', 'i print', 'end', 'end');
    assert.equal(cellSource(state), [
        'for i in 1 to 3',
        '  if i greater 1',
        '    i print',
        '  else',
        '    i print',
        '  end',
        'end',
    ].join('\n'));
    assert.equal(isComplete(state), true);
});

test('knows which array and record forms need an end', () => {
    assert.deepEqual(scanLine('A = array shape 2 3').opens, ['array']);
    assert.deepEqual(scanLine('A = array shape 2 3 pad 0').opens, []);
    assert.deepEqual(scanLine('A = array 1 2 3').opens, []);
    assert.deepEqual(scanLine('A = record').opens, ['record']);
    assert.deepEqual(scanLine('fun double X').opens, ['fun']);
    assert.deepEqual(scanLine('X = 1 fun').opens, []);
});

test('a blank line finishes every open construct', () => {
    const open = cell('fun double X', 'return X * 2');
    assert.equal(isComplete(open), false);
    assert.equal(cellSource(closeCell(open)), 'fun double X\n  return X * 2\nend');

    const nested = cell('for i in 1 to 3', 'if i greater 1', 'i print');
    assert.equal(cellSource(closeCell(nested)), [
        'for i in 1 to 3',
        '  if i greater 1',
        '    i print',
        '  end',
        'end',
    ].join('\n'));

    const folded = cell('A = (1 +');
    assert.equal(cellSource(closeCell(folded)), 'A = (1 +)');
});

test('prompt and indentation report what is open', () => {
    assert.equal(promptFor(EMPTY_CELL), 'rank> ');
    assert.equal(nextIndent(EMPTY_CELL), '');
    assert.equal(promptFor(cell('for i in 1 to 3')), 'for.> ');
    assert.equal(nextIndent(cell('for i in 1 to 3')), '  ');
    assert.equal(promptFor(cell('if A', 'for i in 1 to 3')), 'for.> ');
    assert.equal(nextIndent(cell('if A', 'for i in 1 to 3')), '    ');
    assert.equal(promptFor(cell('A = 1 +')), '....> ');
    assert.equal(promptFor(cell('A = record')), 'reco> ');
    assert.equal(isEmpty(EMPTY_CELL), true);
});

test('runs blocks, folded lines and aliases through the real REPL', () => {
    const source = [
        'use numbers',
        'fun double X',
        '  return X * 2',
        'end',
        '5 double',
        'A gets 1 plus',
        '  2',
        'A',
        'S gets "text',
        'S',
        'M gets array shape 2 3',
        '  1 2 3',
        '  4 5 6',
        'end',
        'M every 1',
    ].join('\n');
    const result = spawnSync(process.execPath, [cli], { input: source, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.deepEqual(result.stdout.trim().split('\n'), [
        '<function double>', '10', '3', '3', 'text', 'text',
        '1 2 3 4 5 6', '2 5',
    ]);
});
