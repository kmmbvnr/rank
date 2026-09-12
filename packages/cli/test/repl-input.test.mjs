import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
    EMPTY_CELL, addLine, cellSource, closeCell, collapseSpaces, expandAssignKey,
    expandCompoundKeywords, expandOperators, formatLine, formatTyping, insideText,
    isComplete, isEmpty, nextIndent, promptFor, scanLine, spaceOperators, startsDedent,
    tokenize,
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

test('rewrites the comma and colon keys into the = they stand for', () => {
    for (const key of [',', ':']) {
        assert.equal(expandAssignKey(`A${key} 3`), 'A = 3');
        assert.equal(expandAssignKey(`A${key}3`), 'A = 3');
        assert.equal(expandAssignKey(`A *${key} 2`), 'A *= 2');
        assert.equal(expandAssignKey(`A and${key} B`), 'A and= B');
        assert.equal(expandAssignKey(`index K${key} V`), 'index K = V');
    }
    assert.equal(expandAssignKey('A = 3'), 'A = 3');
    // Neither key appears in the demo corpus outside text and comments.
    assert.equal(expandAssignKey('A: "at 12:30"'), 'A = "at 12:30"');
    assert.equal(expandAssignKey('A, "one, two"'), 'A = "one, two"');
    assert.equal(expandAssignKey('rem see http://x'), 'rem see http://x');
    assert.equal(expandAssignKey('A: 1 rem note, here'), 'A = 1 rem note, here');
});

test('gives every binary operator one space on each side', () => {
    assert.equal(spaceOperators('A+4*2'), 'A + 4 * 2');
    assert.equal(spaceOperators('A**B'), 'A ** B');
    assert.equal(spaceOperators('A//B'), 'A // B');
    assert.equal(spaceOperators('M#2'), 'M # 2');
    assert.equal(spaceOperators('A+=1'), 'A += 1');
    // A sign is not an operator, and neither is a label dot or a bracket.
    assert.equal(spaceOperators('A = -1'), 'A = -1');
    assert.equal(spaceOperators('Q push -1'), 'Q push -1');
    assert.equal(spaceOperators('1 to -3'), '1 to -3');
    assert.equal(spaceOperators('A .x'), 'A .x');
    assert.equal(spaceOperators('(A+B)'), '(A + B)');
    // Compound keywords are one token spelled with a word.
    assert.equal(spaceOperators('A and= B'), 'A and= B');
    assert.equal(spaceOperators('A = "1+2"'), 'A = "1+2"');
});

test('formats a whole line and a line still being typed', () => {
    assert.equal(formatLine('A,B+1'), 'A = B + 1');
    assert.equal(formatLine('A  =   3'), 'A = 3');
    // While typing, an operator keeps the space that separates what comes next.
    assert.equal(formatTyping('A,'), 'A = ');
    assert.equal(formatTyping('A = 1+'), 'A = 1 + ');
    assert.equal(formatTyping('A = 1 '), 'A = 1 ');
    assert.equal(formatTyping('Val'), 'Val');
});

test('knows the lines that step back out of a block', () => {
    assert.equal(startsDedent('end'), true);
    assert.equal(startsDedent('  else'), true);
    assert.equal(startsDedent('catch Error'), true);
    assert.equal(startsDedent('endgame 2'), false);
    assert.equal(startsDedent('End = 1'), false);
    assert.equal(startsDedent('i print'), false);
    const open = cell('for i in 1 to 3');
    assert.equal(nextIndent(open), '  ');
    assert.equal(nextIndent(open, true), '');
});

test('tidies spacing without touching text or comments', () => {
    assert.equal(collapseSpaces('A  =   3'), 'A = 3');
    assert.equal(collapseSpaces('A = "two  spaces"'), 'A = "two  spaces"');
    assert.equal(collapseSpaces('A = 1 rem  keeps  this'), 'A = 1 rem  keeps  this');
    assert.equal(collapseSpaces('A sort  by .x'), 'A sort by .x');
});

test('knows when a position sits inside text or a comment', () => {
    assert.equal(insideText('A = "open'), true);
    assert.equal(insideText('A = "shut"'), false);
    assert.equal(insideText('rem note'), true);
    assert.equal(insideText('A = 1'), false);
    assert.equal(insideText(''), false);
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
    const state = cell('for i in 1 to 3', 'if i greater 1', 'i print', 'else',
        'i print', 'end', 'end');
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
        'Label: "at 12:30"',
        'Label',
        'Tight,A+1',
        'Tight',
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
        'at 12:30', 'at 12:30', '4', '4', '1 2 3 4 5 6', '2 5',
    ]);
});
