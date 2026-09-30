import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { describe, expect, it } from 'vitest';
import {
    createRankServices, isApplicationExpression, isBinaryExpression,
    isExpressionStatement, isParenthesizedExpression, type Program,
} from '../src/index.js';

const parse = parseHelper<Program>(createRankServices(EmptyFileSystem).Rank);

describe('shared expression grouping', () => {
    it('treats nullary names as data inside formulas and selector chains', async () => {
        const document = await parse('use numbers\nfun pos\n return 1\nend\nA = array 4 9\n2 + A pos sqrt', { validation: true });
        expect(document.diagnostics).toEqual([]);
        const statement = document.parseResult.value.statements.at(-1)!;
        if (!isExpressionStatement(statement) || !isApplicationExpression(statement.value)) throw new Error('expected sqrt call');
        expect(statement.value.arguments).toMatchObject([{ name: 'sqrt' }]);
        const source = statement.value.head;
        if (!isParenthesizedExpression(source) || !isBinaryExpression(source.value)) throw new Error('expected accumulated formula');
        expect(source.value.operator).toBe('+');
        expect(source.value.right).toMatchObject({
            $type: 'ApplicationExpression', head: { name: 'A' }, arguments: [{ name: 'pos' }],
        });
    });

    it.each([
        ['"1203" integer rank 0', 'use text\nuse numbers'],
        ['M sum axis 0', 'use numbers'],
        ['M sum axis 0 rank 1', 'use numbers'],
        ['M argsort axis 1 .descending', 'use sequences\nuse numbers'],
        ['M scan +', 'use numbers'],
        ['M scan + axis 0', 'use numbers'],
        ['M scan next axis 1', 'use numbers'],
        ['M scan next', 'use numbers'],
        ['M scan next with Seed', 'use numbers'],
        ['M scan next with (1 + 2)', 'use numbers'],
        ['M reduce + rank 1', 'use numbers'],
        ['A B outer *', 'use numbers'],
        ['M segment min', 'use algo\nuse numbers'],
        ['M segment combine with Identity', 'use algo\nuse numbers'],
    ])('groups %s before the next call for every syntax consumer', async (prefix, imports) => {
        const document = await parse(`${imports}\n${prefix} sum`);
        expect(document.parseResult.parserErrors).toEqual([]);
        const statement = document.parseResult.value.statements.at(-1)!;
        if (!isExpressionStatement(statement) || !isApplicationExpression(statement.value)) throw new Error('expected call');
        const call = statement.value;
        expect(call.arguments).toMatchObject([{ $type: 'NameExpression', name: 'sum' }]);
        if (!isParenthesizedExpression(call.head)) throw new Error('expected completed modifier call');
        expect(call.$cstNode?.astNode).toBe(call);
        expect(call.head.$container).toBe(call);
        expect(call.head.value.$container).toBe(call.head);
    });

    it('exposes the accumulated formula to editor and analysis clients', async () => {
        const document = await parse('use numbers\n2 + 9 sqrt');
        const statement = document.parseResult.value.statements[1];
        expect(isExpressionStatement(statement)).toBe(true);
        if (!isExpressionStatement(statement) || !isApplicationExpression(statement.value)) throw new Error('expected call');
        expect(statement.value.$cstNode?.astNode).toBe(statement.value);
        const head = statement.value.head;
        expect(isParenthesizedExpression(head)).toBe(true);
        if (!isParenthesizedExpression(head)) throw new Error('expected grouped operand');
        expect(isBinaryExpression(head.value) && head.value.operator).toBe('+');
        expect(head.$container).toBe(statement.value);
        expect(head.value.$container).toBe(head);
    });

    it('validates comparison chains with the same message and location as the REPL', async () => {
        const document = await parse('1 equal 2 equal false', { validation: true });
        expect(document.diagnostics).toHaveLength(1);
        expect(document.diagnostics![0]).toMatchObject({
            message: 'Comparison chains require explicit grouping. Add parentheses or introduce an intermediate variable.',
            range: { start: { line: 0, character: 10 } },
        });
    });

    it('accepts separate operands and explicit groups but rejects a resumed call', async () => {
        const valid = await parse('use sequences\nA len equal B len\n(A equal B) count', { validation: true });
        expect(valid.diagnostics).toEqual([]);
        const invalid = await parse('use numbers\n2 sqrt + 1 sqrt', { validation: true });
        expect(invalid.diagnostics).toHaveLength(1);
        expect(invalid.diagnostics![0]).toMatchObject({
            message: expect.stringContaining('intermediate variable'),
            range: { start: { line: 1, character: 11 } },
        });
    });

    describe('higher-order operations', () => {
        const shape = (expression: any): string => {
            switch (expression?.$type) {
                case 'BinaryExpression': return `(${shape(expression.left)} ${expression.operator} ${shape(expression.right)})`;
                case 'ApplicationExpression': return `[${shape(expression.head)} ${expression.arguments.map(shape).join(' ')}]`;
                case 'ParenthesizedExpression': return `<${shape(expression.value)}>`;
                case 'NameExpression': return expression.name;
                case 'NumberLiteral': return String(expression.value);
                default: return expression?.$type ?? 'missing';
            }
        };
        const grouped = async (source: string) => {
            const document = await parse(`use numbers\nuse sequences\n${source}`, { validation: true });
            const statement = document.parseResult.value.statements.at(-1)!;
            if (!isExpressionStatement(statement)) throw new Error('expected expression');
            return { tree: shape(statement.value), messages: document.diagnostics!.map(item => item.message) };
        };

        it.each([
            ['A scan + with 0', 'A + scan with 0'],
            ['A reduce * rank 1', 'A * reduce rank 1'],
            ['A segment +', 'A + segment'],
            ['A B outer *', 'A B * outer'],
            ['A B outer not equal', 'A B not equal outer'],
            ['Start + Y scan +', 'Start + Y + scan'],
            ['A scan + with 0 sum', 'A + scan with 0 sum'],
            ['Steps scan next with Start', 'Steps next scan with Start'],
            ['A B outer min', 'A B min outer'],
            ['A segment min', 'A min segment'],
        ])('reads %s as the call form the runtime executes', async (written, call) => {
            const { tree, messages } = await grouped(written);
            expect(messages).toEqual([]);
            const expected = await parse(`use numbers\nuse sequences\n${call}`);
            const statement = expected.parseResult.value.statements.at(-1)!;
            if (!isExpressionStatement(statement)) throw new Error('expected expression');
            expect(tree).toBe(shape(statement.value));
        });

        it('applies the operation to the whole expression on its left', async () => {
            expect((await grouped('Start + Y scan +')).tree).toBe('((Start + Y) + scan)');
            expect((await grouped('A * 2 + B reduce +')).tree).toBe('(((A * 2) + B) + reduce)');
        });

        it.each([
            ['A + scan with 0', '`scan` takes its combining operation after it. Write `A scan +` instead of `A + scan`.'],
            ['A B * outer', '`outer` takes its combining operation after it. Write `A outer *` instead of `A * outer`.'],
            ['Steps next scan with Start', 'scan needs its combining operation after it, e.g. `Range scan + with 0` or `Range scan next with Start`.'],
            ['Steps next scan', 'scan needs its combining operation after it, e.g. `Range scan + with 0` or `Range scan next with Start`.'],
        ])('rejects the old order of %s', async (source, message) => {
            expect((await grouped(source)).messages).toEqual([message]);
        });

        it('keeps a rank and axis call parameter after its function', async () => {
            expect((await grouped('A F rank 0')).messages).toEqual([]);
            expect((await grouped('M sum axis 0')).messages).toEqual([]);
        });

        it('leaves a program binding of the operation alone', async () => {
            const bound = 'fun scan X\n  return X\nend\n';
            const named = await grouped(`${bound}A scan next with Start`);
            expect(named.messages).toEqual([]);
            expect(named.tree).toBe('[[[[A scan] next] with] Start]');
            const symbol = await grouped(`${bound}A scan +`);
            expect(symbol.messages).toEqual([expect.stringContaining('`scan` is rebound in this program')]);
        });

        it('rejects a joined operation that has nothing on its left', async () => {
            expect((await grouped('scan +')).messages).toEqual([expect.stringContaining('needs the values it applies to on its left')]);
        });
    });
});
