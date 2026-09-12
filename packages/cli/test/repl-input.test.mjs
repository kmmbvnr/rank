import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
    EMPTY_CELL, addLine, cellSource, closeCell, collapseSpaces, expandAssignKey,
    expandCompoundKeywords, expandOperators, formatLine, formatTyping, insideText,
    isComplete, isEmpty, nextIndent, promptFor, scanLine, spaceOperators, startsDedent,
    tokenize, wrapSource,
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
    assert.equal(formatLine('A B leftjoin on .x, .y'), 'A B leftjoin on .x equal .y');
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

test('wraps a wide line into brackets and narrow lines', () => {
    // Under the limit nothing moves, even over the target width.
    assert.equal(wrapSource('A = Price * Discount + Quantity'),
        'A = Price * Discount + Quantity');
    assert.equal(wrapSource('Revenue = Price * Discount + Quantity * Extra + More'), [
        'Revenue = (',
        '  Price * Discount + Quantity * Extra',
        '  + More',
        ')',
    ].join('\n'));
    // Brackets already there are reused rather than doubled.
    assert.equal(wrapSource('Revenue = (Price * Discount + Quantity * Extra + More)'), [
        'Revenue = (',
        '  Price * Discount + Quantity * Extra',
        '  + More',
        ')',
    ].join('\n'));
    // The line keeps the indentation of its block.
    assert.equal(wrapSource('  Revenue = Price * Discount + Quantity * Extra + More'), [
        '  Revenue = (',
        '    Price * Discount + Quantity * Extra',
        '    + More',
        '  )',
    ].join('\n'));
    // An application chain has no place to break, so it stays one line.
    const chain = 'Total = Values sum print with a very long chain of names here';
    assert.equal(wrapSource(chain), chain);
    // Join key pairs are kept intact by the generic line wrapper.
    const join = 'Joined = Left Right leftjoin on .store equal .family .a equal .b .c equal .d';
    assert.equal(wrapSource(join), join);
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

/**
 * Drives the real prompt through a pty so readline completion actually runs. A
 * tab in a line is sent on its own: readline treats a burst that contains one
 * as plain text, and only a keypress of its own completes.
 */
function complete(lines, completion = '') {
    const steps = [];
    for (const line of lines) {
        for (const [index, piece] of line.split('\t').entries()) {
            if (index > 0) {
                steps.push('send "\\t"');
                steps.push(completion
                    ? `expect ${JSON.stringify(completion)}` : 'sleep 0.3');
            }
            if (piece !== '') steps.push(`send ${JSON.stringify(piece)}`, 'sleep 0.2');
        }
        steps.push('send "\\r"', 'expect "rank> "');
    }
    const file = path.join(os.tmpdir(), `rank-complete-${process.pid}.exp`);
    fs.writeFileSync(file, [
        'set timeout 10',
        `spawn ${process.execPath} ${cli}`,
        'expect "rank> "',
        ...steps,
        'send "exit\\r"',
        'expect eof',
    ].join('\n'));
    try {
        return spawnSync('expect', ['-f', file], { encoding: 'utf8' }).stdout ?? '';
    } finally {
        fs.rmSync(file, { force: true });
    }
}

// The prompt has to offer what the grammar fixes: a declared input takes one of
// five types, and a spelled operator is two words that arrive as one.
test('completion offers the types a declared input accepts', () => {
    const session = complete(['option Limit integ\t 1', 'argument Path \t\t']);
    assert.match(session, /Limit integer/);
    for (const type of ['boolean', 'integer', 'path', 'real', 'text']) {
        assert.match(session, new RegExp(`\\b${type}\\b`));
    }
});

test('completion finishes a two-word operator whole', () => {
    // The operand comes after: a line ending in an operator folds instead of
    // running, which is the prompt behaving correctly.
    const session = complete(['use numbers', 'N = 3', 'Mask = N mul\t2'], 'multiple by');
    // The prompt redraws with escape codes between its parts, so match the
    // completed text rather than the whole line.
    assert.match(session, /N multiple by 2/);
    assert.match(complete(['A = 1', 'B = A at l\t0']), /A at least 0/);
});
