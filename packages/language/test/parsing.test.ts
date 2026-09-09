import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    type Program,
    createRankServices,
    isApplicationExpression,
    isAssignmentStatement,
    isBinaryExpression,
    isUnaryExpression,
} from '../src/index.js';

let parse: ReturnType<typeof parseHelper<Program>>;

beforeAll(() => {
    parse = parseHelper<Program>(createRankServices(EmptyFileSystem).Rank);
});

describe('Rank grammar', () => {
    it('parses a program and preserves operator precedence', async () => {
        const document = await parse('Answer = 2 + 3 * 4');
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);

        const statement = document.parseResult.value.statements[0];
        expect(isAssignmentStatement(statement)).toBe(true);
        if (!isAssignmentStatement(statement)) return;
        expect(isBinaryExpression(statement.value) && statement.value.operator).toBe('+');
        expect(isBinaryExpression(statement.value) && isBinaryExpression(statement.value.right)).toBe(true);
    });

    it('parses inclusive comparison and padded addressing', async () => {
        const document = await parse([
            'Last = index Ci pad -1',
            'Ready = Last at least Start',
            'Before = Last at most Finish',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(3);
    });

    it('parses real and floor division expressions', async () => {
        const document = await parse('Mean = 5 / 2.0\nPage = 5 // 2\nPage //= 2');
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(3);
    });

    it('parses right-associative exponentiation above unary signs', async () => {
        const document = await parse('Answer = -2 ** 3 ** 2\nAnswer **= 2');
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);

        const statement = document.parseResult.value.statements[0];
        expect(isAssignmentStatement(statement)).toBe(true);
        if (!isAssignmentStatement(statement)) return;
        expect(isBinaryExpression(statement.value) && statement.value.operator).toBe('**');
        if (!isBinaryExpression(statement.value)) return;
        expect(isUnaryExpression(statement.value.left)).toBe(true);
        expect(isBinaryExpression(statement.value.right) && statement.value.right.operator).toBe('**');
    });

    it('parses imported words as ordinary application', async () => {
        const document = await parse('use ranges\nuse numbers\n1 to 10 sum');
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(3);
    });

    it('applies a leading unary operator before postfix application', async () => {
        const document = await parse('Answer = -121 palindrome');
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);

        const statement = document.parseResult.value.statements[0];
        expect(isAssignmentStatement(statement)).toBe(true);
        if (!isAssignmentStatement(statement)) return;
        expect(isApplicationExpression(statement.value)).toBe(true);
        if (!isApplicationExpression(statement.value)) return;
        expect(isUnaryExpression(statement.value.head)).toBe(true);
        expect(statement.value.arguments).toHaveLength(1);
    });

    it('treats rem lines as comments', async () => {
        const document = await parse('rem Rank comment\nAnswer = 42\nremember');
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(2);
    });

    it('parses program imports, options, runs and tests', async () => {
        const document = await parse([
            'use testing',
            'test "limit 10"',
            '  use "001_multiples" as E',
            '  E.Limit = 10',
            '  E.run',
            '  E.Answer equal 23',
            'end',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(2);
    });

    it('parses open imports and input declarations', async () => {
        const document = await parse([
            'use "worker"',
            'option Limit integer = 1000',
            'args "--limit" "10"',
            'run "worker"',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
    });

    it('parses nested for and if blocks', async () => {
        const document = await parse([
            'for i in 0 until 3',
            '  if i greater 0',
            '    Total += i',
            '  else',
            '    Total = 0',
            '  end',
            'end',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(1);
    });

    it('parses conditional and infinite for blocks', async () => {
        const document = await parse([
            'for Count less 3',
            '  Count += 1',
            'end',
            'for',
            '  break',
            'end',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(2);
    });

    it('parses typed and catch-all error handlers', async () => {
        const document = await parse([
            'try',
            '  .InvalidAge Age raise',
            'catch .InvalidAge Error',
            '  Error .Value print',
            'catch Error',
            '  Error raise',
            'finally',
            '  Resource close',
            'end',
            'try',
            '  Work',
            'finally',
            '  Cleanup',
            'end',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(2);
    });

    it('parses tensor for bindings with axis and cell rank', async () => {
        const document = await parse([
            'for Line i j in T axis 0 1 rank 1',
            '  Total += Line 0',
            'end',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(1);
    });

    it('parses functions, array construction and keyed index assignment', async () => {
        const document = await parse([
            'fun two_sum A Target',
            '  for Value i in A',
            '    if Value in index',
            '      return array Value i',
            '    end',
            '    index Value = i',
            '  end',
            'end',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(1);
    });

    it('parses shaped array blocks', async () => {
        const document = await parse([
            'M = array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
            'M equal array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(2);
    });

    it('parses an array as the right operand of a comparison', async () => {
        const document = await parse('Answer equal array 7 0 8');
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(1);
    });

    it('parses ranges, slices and array selectors without brackets', async () => {
        const document = await parse([
            'Range = 1 to 5',
            'Odds = 1 to 9 by 2',
            'Countdown = 10 until 0 by 2',
            'Part = Text from L until R',
            'Letters = Text array 0 2 6',
            'Rows = M axis 0 from First to Last',
            'Columns = M axis 1 array 0 2',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(7);
    });

    it('parses a receiver method with one expression argument', async () => {
        const document = await parse('queue push Value + 1');
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(1);
    });
});
