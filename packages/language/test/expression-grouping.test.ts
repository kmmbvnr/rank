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
        ['M argsort axis 1 descending', 'use sequences\nuse numbers'],
        ['M + scan', 'use numbers'],
        ['M next scan', 'use numbers'],
        ['M next scan with Seed', 'use numbers'],
        ['M next scan with (1 + 2)', 'use numbers'],
        ['M + reduce rank 1', 'use numbers'],
        ['A B * outer', 'use numbers'],
        ['M min segment', 'use algo\nuse numbers'],
        ['M combine segment with Identity', 'use algo\nuse numbers'],
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
});
