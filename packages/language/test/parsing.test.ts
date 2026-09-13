import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    type Program,
    createRankServices,
    isApplicationExpression,
    isAliasedTableExpression,
    isArrayAssignmentStatement,
    isAssignmentStatement,
    isBinaryExpression,
    isExpressionStatement,
    isKeyedSortExpression,
    isKeyedGroupExpression,
    isKeyedJoinExpression,
    isMaterializeExpression,
    isUnpackStatement,
    isUnaryExpression,
} from '../src/index.js';

let parse: ReturnType<typeof parseHelper<Program>>;

beforeAll(() => {
    parse = parseHelper<Program>(createRankServices(EmptyFileSystem).Rank);
});

describe('Rank grammar', () => {
    it('parses contextual table blocks, field lists, records and per-key directions', async () => {
        const document = await parse([
            'R = Db .members filter .id greater 0',
            'R = R filter',
            '  .id equal 1 or .id equal 2',
            '  .cost greater 10',
            'end',
            'R = R select',
            '  Cost = .cost * 2',
            '  .total = Cost',
            'end',
            'One = R select .total',
            'Dynamic = R select Cols',
            'S = R sort by .total descending .name ascending',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(6);
        const statement = document.parseResult.value.statements[5];
        if (!isAssignmentStatement(statement) || !isKeyedSortExpression(statement.value)) throw new Error('expected sort');
        expect(statement.value.fields.map(field => [field.field.name, field.direction]))
            .toEqual([['total', 'descending'], ['name', 'ascending']]);
    });

    it('rejects empty table blocks, condition assignment and the superseded select call', async () => {
        for (const source of ['R = Rows filter\nend', 'R = Rows select\nend',
            'R = Rows filter .x = 1', 'R = Rows Cols select']) {
            const document = await parse(source);
            expect(document.parseResult.parserErrors.length).toBeGreaterThan(0);
        }
    });

    it('parses continue as a statement in nested loop bodies', async () => {
        const document = await parse('for I in Items\n  if I equal 0\n    continue\n  end\nend');
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        const loop = document.parseResult.value.statements[0];
        expect(loop.$type).toBe('ForStatement');
        if (loop.$type !== 'ForStatement') throw new Error('expected loop');
        const branch = loop.statements[0];
        if (branch.$type !== 'IfStatement') throw new Error('expected branch');
        expect(branch.thenStatements[0].$type).toBe('ContinueStatement');
    });

    it('parses field and function ordering keys', async () => {
        const document = await parse([
            'Fields = Events sort by .time .delta',
            'Values = Events sort by eventkey',
            'Order = Events argsort by .time',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);

        const fields = document.parseResult.value.statements[0];
        const key = document.parseResult.value.statements[1];
        expect(isAssignmentStatement(fields)).toBe(true);
        expect(isAssignmentStatement(key)).toBe(true);
        if (!isAssignmentStatement(fields) || !isAssignmentStatement(key)) return;
        expect(isKeyedSortExpression(fields.value)).toBe(true);
        expect(isKeyedSortExpression(key.value)).toBe(true);
        if (!isKeyedSortExpression(fields.value) || !isKeyedSortExpression(key.value)) return;
        expect(fields.value.fields.map(field => field.field.name)).toEqual(['time', 'delta']);
        expect(key.value.key?.name).toBe('eventkey');
        expect(document.parseResult.value.statements).toHaveLength(3);
    });

    it('parses one or several table keys without array construction', async () => {
        const document = await parse([
            'One = Rows group by .store',
            'Several = Rows group by .store .family .weekday',
            'Totals = Rows rollup by .store .family',
            'Left = Test Means leftjoin by .store .family .weekday',
            'Inner = Orders Customers innerjoin by .custkey',
            'Mapped = Orders Customers innerjoin on .o_custkey equal .c_custkey',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        const statements = document.parseResult.value.statements;
        if (!statements.every(isAssignmentStatement)) throw new Error('expected assignments');
        expect(isKeyedGroupExpression(statements[0].value)).toBe(true);
        expect(isKeyedGroupExpression(statements[1].value)).toBe(true);
        expect(isKeyedGroupExpression(statements[2].value)).toBe(true);
        expect(isKeyedJoinExpression(statements[3].value)).toBe(true);
        expect(isKeyedJoinExpression(statements[4].value)).toBe(true);
        expect(isKeyedJoinExpression(statements[5].value)).toBe(true);
        if (!isKeyedGroupExpression(statements[1].value)
            || !isKeyedGroupExpression(statements[2].value)
            || !isKeyedJoinExpression(statements[3].value)) return;
        expect(statements[1].value.fields.map(field => field.name))
            .toEqual(['store', 'family', 'weekday']);
        expect(statements[2].value.operator).toBe('rollup by');
        expect(statements[3].value.fields.map(field => field.name))
            .toEqual(['store', 'family', 'weekday']);
        if (!isKeyedJoinExpression(statements[5].value)) return;
        expect(statements[5].value.pairs.map(pair => [pair.left.name, pair.right.name]))
            .toEqual([['o_custkey', 'c_custkey']]);
    });

    it('parses table aliases without parentheses and a folded equal join', async () => {
        const document = await parse([
            'M = Db .members alias .m',
            'R = Db .members alias .r',
            'J = M R leftjoin on',
            '  .recommendedby equal .memid',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        const statements = document.parseResult.value.statements;
        if (!statements.every(isAssignmentStatement)) throw new Error('expected assignments');
        expect(isAliasedTableExpression(statements[0].value)).toBe(true);
        expect(isAliasedTableExpression(statements[1].value)).toBe(true);
        expect(isKeyedJoinExpression(statements[2].value)).toBe(true);
    });

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

    it('parses a runtime type guard', async () => {
        const document = await parse([
            'if Value is .integer',
            '  Answer = Value + 1',
            'end',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(1);
    });

    it('parses explicit structure creation inside assignments and calls', async () => {
        const document = await parse([
            'A = new index',
            'B = new queue',
            'C = new set',
            'D = new counter',
            'E = new multiset',
            'F = new dsu Nodes',
            'B push new set',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements[0]).toMatchObject({
            $type: 'AssignmentStatement',
            value: { $type: 'NewStructureExpression', structure: 'index' },
        });
    });

    it('parses real and floor division expressions', async () => {
        const document = await parse('Mean = 5 / 2.0\nPage = 5 // 2\nPage //= 2');
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(3);
    });

    it('parses explicit unpacking from a formatted text expression', async () => {
        const document = await parse([
            'Pattern = "/integerx/integerx/integer"',
            'unpack Length Width Height = Line Pattern parse',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);

        const statement = document.parseResult.value.statements[1];
        expect(isUnpackStatement(statement)).toBe(true);
        if (!isUnpackStatement(statement)) return;
        expect(statement.names).toEqual(['Length', 'Width', 'Height']);
    });

    it('parses discarded unpack positions', async () => {
        const document = await parse('unpack From To # = Edge');
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        const statement = document.parseResult.value.statements[0];
        expect(isUnpackStatement(statement)).toBe(true);
        if (!isUnpackStatement(statement)) return;
        expect(statement.names).toEqual(['From', 'To', '#']);
    });

    it('reserves a multi-part target for addressed assignment', async () => {
        const document = await parse('A B = array 1 2');
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);

        const statement = document.parseResult.value.statements[0];
        expect(isArrayAssignmentStatement(statement)).toBe(true);
        if (!isArrayAssignmentStatement(statement)) return;
        expect(statement.name).toBe('A');
        expect(statement.indices).toHaveLength(1);
    });

    it('parses unpacked application arguments and selectors', async () => {
        const document = await parse([
            'Value = Index unpack Point',
            'Index unpack (array X Y) = 1',
            'Result = unpack Point distance',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(3);
    });

    it('parses a filled shaped array and addressed assignment', async () => {
        const document = await parse([
            'Dist = array shape N N pad -1',
            'Dist Y X = NextDist',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(2);
        expect(isAssignmentStatement(document.parseResult.value.statements[0])).toBe(true);
        expect(isArrayAssignmentStatement(document.parseResult.value.statements[1])).toBe(true);
    });

    it('parses whole-axis tensor addressing and assignment', async () => {
        const document = await parse([
            'Column = A # j',
            'Total = A # j sum',
            'A # j = Values',
            'T # # k = 0',
            'A # j *= -1',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(5);
        expect(isArrayAssignmentStatement(document.parseResult.value.statements[2])).toBe(true);
        expect(isArrayAssignmentStatement(document.parseResult.value.statements[3])).toBe(true);
        const compound = document.parseResult.value.statements[4];
        expect(isArrayAssignmentStatement(compound)).toBe(true);
        if (isArrayAssignmentStatement(compound)) expect(compound.operator).toBe('*=');
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
        const document = await parse([
            'use ranges',
            'use numbers',
            'use sequences',
            '1 to 10 sum',
            'Dims = A shape',
            'Columns = A len axis 1',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(6);
    });

    it('parses matmul with an explicit axis pair', async () => {
        const document = await parse([
            'use linalg',
            'C = A B matmul axis 2 0',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(2);
    });

    it('parses covariance with feature and observation axes', async () => {
        const document = await parse([
            'use stats',
            'C = Data covariance axis 1 0',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(2);
    });

    it('parses decimal-place rounding after its data', async () => {
        const document = await parse([
            'use numbers',
            'Rounded = Values round 4',
            'Hundreds = Count round -2',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(3);
    });

    it('parses data-first trigonometric calls', async () => {
        const document = await parse([
            'use numbers',
            'Angle = Y X atan2',
            'Wave = Angles sin',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(3);
    });

    it('parses an explicit writable tensor copy', async () => {
        const document = await parse([
            'use sequences',
            'Writable = Lazy copy',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(2);
    });

    it('parses record construction and field assignment', async () => {
        const document = await parse([
            'Node = record',
            '  .data = 2.0',
            '  .grad = 0.0',
            'end',
            'Node .grad += 1.0',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(2);
        expect(isArrayAssignmentStatement(document.parseResult.value.statements[1])).toBe(true);
    });

    it('parses determinant application with rank and axis', async () => {
        const document = await parse([
            'use linalg',
            'Values = T det axis 1 rank 2',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(2);
    });

    it('parses a data-first linear solve', async () => {
        const document = await parse([
            'use linalg',
            'X = A B solve',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(2);
    });

    it('continues expressions across lines inside parentheses', async () => {
        const document = await parse([
            'Result = (',
            '  A + B',
            '  * C',
            ') / D',
            'Mask = (',
            '  A greater 0',
            '  and B less 10',
            ')',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(2);
    });

    it('parses a named function modified by outer', async () => {
        const document = await parse('Grid = Values Values bxor outer');
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);

        const statement = document.parseResult.value.statements[0];
        expect(isAssignmentStatement(statement)).toBe(true);
        if (!isAssignmentStatement(statement)) return;
        expect(isApplicationExpression(statement.value)).toBe(true);
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

    it('parses a local function at the end of its enclosing function', async () => {
        const document = await parse([
            'fun make Base',
            '  return add',
            '',
            '  fun add Value',
            '    return Base + Value',
            '  end',
            'end',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(1);
    });

    it('parses elif branches before an optional else', async () => {
        const document = await parse([
            'if Value less 0',
            '  Kind = "negative"',
            'elif Value equal 0',
            '  Kind = "zero"',
            'elif Value equal 1',
            '  Kind = "one"',
            'else',
            '  Kind = "many"',
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

    it('parses windows and ranked reductions', async () => {
        const document = await parse([
            'Windows = Values 3 window',
            'Rows = Matrix 3 window axis 1',
            'Products = Windows * reduce rank 1',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(3);
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

    it('parses memo declarations as functions, including local declarations', async () => {
        const document = await parse('fun solve N\n memo fib X\n  return X\n end\n return N fib\nend');
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements[0]).toMatchObject({
            $type: 'FunctionStatement', memo: false,
            statements: [expect.objectContaining({ $type: 'FunctionStatement', memo: true }), expect.anything()],
        });
    });

    it('parses generator functions, bare return and typed stdin', async () => {
        const document = await parse([
            'use io',
            'fun values N',
            '  yield N',
            '  return',
            'end',
            'N = stdin .integer',
            'Word = stdin .word',
            'Values = stdin .integer (N - 1) array',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(5);
    });

    it('parses postfix sequence materialization separately from array selectors', async () => {
        const document = await parse([
            'Values = 3 values array',
            'Picked = Text array 0 2 6',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        const statement = document.parseResult.value.statements[0];
        expect(isAssignmentStatement(statement)).toBe(true);
        if (!isAssignmentStatement(statement)) return;
        expect(isMaterializeExpression(statement.value)).toBe(true);
    });

    it('continues an application after postfix sequence materialization', async () => {
        const document = await parse('Count = Values array len print');
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
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
            'Countdown = 10 until 0 by -2',
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
        const document = await parse([
            'queue push Value + 1',
            'set add array X Y',
            'counter add Value',
            'Bag remove Right - Left',
        ].join('\n'));
        expect(document.parseResult.lexerErrors).toEqual([]);
        expect(document.parseResult.parserErrors).toEqual([]);
        expect(document.parseResult.value.statements).toHaveLength(4);
        expect(isExpressionStatement(
            document.parseResult.value.statements[3],
        )).toBe(true);
    });
});
