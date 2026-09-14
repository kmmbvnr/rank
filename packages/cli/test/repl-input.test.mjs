import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
    EMPTY_CELL, addLine, cellSource, closeCell, collapseSpaces, expandAssignKey,
    expandCompoundKeywords, expandOperators, formatLine, insideText,
    isComplete, isEmpty, nextIndent, scanLine, spaceOperators, startsDedent,
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

test('rewrites the comma key into the = it stands for', () => {
    const key = ',';
    assert.equal(expandAssignKey(`A${key} 3`), 'A = 3');
    assert.equal(expandAssignKey(`A${key}3`), 'A = 3');
    assert.equal(expandAssignKey(`A *${key} 2`), 'A *= 2');
    assert.equal(expandAssignKey(`A and${key} B`), 'A and= B');
    assert.equal(expandAssignKey(`index K${key} V`), 'index K = V');
    assert.equal(expandAssignKey('A = 3'), 'A = 3');
    // A colon is left alone; it no longer stands for `=`.
    assert.equal(expandAssignKey('A: "at 12:30"'), 'A: "at 12:30"');
    // The key does not appear in the demo corpus outside text and comments.
    assert.equal(expandAssignKey('A, "one, two"'), 'A = "one, two"');
    assert.equal(expandAssignKey('rem see http://x'), 'rem see http://x');
    assert.equal(expandAssignKey('A, 1 rem note, here'), 'A = 1 rem note, here');
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

test('formats a whole line', () => {
    assert.equal(formatLine('A,B+1'), 'A = B + 1');
    assert.equal(formatLine('A  =   3'), 'A = 3');
    assert.equal(formatLine('A B leftjoin on .x, .y'), 'A B leftjoin on .x equal .y');
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
    // `group by` and `leftjoin on` want fields; `sort` is also a plain name.
    assert.equal(scanLine('Rows group by').folds, true);
    assert.equal(scanLine('Left Right leftjoin on').folds, true);
    assert.equal(scanLine('Rows group by .store').folds, false);
    assert.equal(scanLine('Values sort').folds, false);

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

test('an open bracket keeps folding when more of the line is known to follow', () => {
    // Recalling a wrapped statement replays each of its lines with more still
    // to come, so an operand-ending line inside an open bracket must not
    // close early and run a truncated fragment.
    let state = addLine(EMPTY_CELL, 'A = (1 + 2', true);
    assert.equal(isComplete(state), false);
    state = addLine(state, '+ 3)', true);
    assert.equal(isComplete(state), true);
    assert.equal(cellSource(state), 'A = (1 + 2 + 3)');
    // With nothing more promised, the same first line still closes on its own.
    assert.equal(cellSource(addLine(EMPTY_CELL, 'A = (1 + 2')), 'A = (1 + 2)');
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

test('collects table blocks without delaying inline select and filter', () => {
    assert.deepEqual(scanLine('R = Rows filter').opens, ['filter']);
    assert.deepEqual(scanLine('R = Rows select rem columns follow').opens, ['select']);
    assert.deepEqual(scanLine('R = Rows filter .id greater 0').opens, []);
    assert.deepEqual(scanLine('R = Rows select .name').opens, []);
    assert.deepEqual(scanLine('R = Rows select Cols').opens, []);
    assert.deepEqual(scanLine('T update').opens, ['update']);
    assert.deepEqual(scanLine('sql T update').opens, ['update']);
    assert.deepEqual(scanLine('fun update X').opens, ['fun']);
    assert.deepEqual(scanLine('Label = .select').opens, []);
    const state = cell('R = Rows select', 'Cost = .price * 2', '.cost = Cost');
    assert.equal(isComplete(state), false);
    assert.equal(cellSource(closeCell(state)), 'R = Rows select\n  Cost = .price * 2\n  .cost = Cost\nend');
});

test('executes contextual table blocks entered through the REPL', () => {
    const rows = JSON.stringify(JSON.stringify([{ id: 1, cost: 10 }, { id: 2, cost: 20 }]));
    const input = ['use tables', 'use json', 'use numbers', `R = ${rows} json`,
        'R = R filter', '.id equal 2', 'end',
        'R = R select', 'Cost = .cost * 2', '.total = Cost', 'end',
        'R .total sum', '',
    ].join('\n');
    const result = spawnSync(process.execPath, [cli], { input, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /40\s*$/);
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
    assert.equal(nextIndent(EMPTY_CELL), '');
    assert.equal(nextIndent(cell('for i in 1 to 3')), '  ');
    assert.equal(nextIndent(cell('if A', 'for i in 1 to 3')), '    ');
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
        'Label, "at 12:30"',
        'Label',
        'Tight,A+1',
        'Tight',
        'M gets array shape 2 3',
        '  1 2 3',
        '  4 5 6',
        'end',
        'M every 1',
        'Wide, 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11 + 12',
    ].join('\n');
    const result = spawnSync(process.execPath, [cli], { input: source, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.deepEqual(result.stdout.trim().split('\n'), [
        '<function double>', '10', '3', '3', 'text', 'text',
        'at 12:30', 'at 12:30', '4', '4',
        // A tensor prints flat, so the preview names the shape underneath it.
        '1 2 3 4 5 6', 'shape 2 3', '2 5', '78',
    ]);
});
