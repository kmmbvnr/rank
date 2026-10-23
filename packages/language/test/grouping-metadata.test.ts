import { AstUtils, EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { analyzeBindings, createRankServices, expressionDiagnostics, groupExpressions,
    isNameExpression, nameNeedsExecution, requiresDataOperand, type Expression, type Program } from '../src/index.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
const parse = (source: string): Program => {
    const result = parser.parse<Program>(source);
    expect(result.lexerErrors).toEqual([]);
    expect(result.parserErrors).toEqual([]);
    return result.value;
};
const reads = (program: Program, name: string) =>
    [...AstUtils.streamAllContents(program)].filter(isNameExpression).filter(node => node.name === name);

it.each(['shared', 'absent'])('resolves distinct binding reads with %s source locations', location => {
    const program = parse('fun X helper\n return X\nend\nA = array 4 9\nResult = 2 + A 0 helper\n');
    const nodes = [...AstUtils.streamAllContents(program)];
    const shared = reads(program, 'helper')[0].$cstNode;
    for (const node of nodes) Object.assign(node, { $cstNode: location === 'shared' ? shared : undefined });
    const found = new Map<string, readonly number[] | undefined>();
    analyzeBindings(program, [], new Map(), (node, binding) => {
        if (isNameExpression(node)) found.set(node.name, binding?.arities);
    });
    expect(found.get('helper')).toEqual([1]);
    expect(found.get('A')).toBeUndefined();
    const grouped = groupExpressions(program);
    expect(grouped.diagnostics).toEqual([]);
    expect(nameNeedsExecution(reads(program, 'helper')[0])).toBe(false);
    expect(nameNeedsExecution(reads(program, 'A')[0])).toBe(false);
    const statement = program.statements.at(-1)!;
    expect(statement).toMatchObject({ value: { $type: 'ApplicationExpression', arguments: [{ name: 'helper' }] } });
});

it('keeps direct-read and data-operand annotations when an expression is spread', () => {
    const program = parse('use numbers\nA = array 4 9\nSelector = 0\nResult = 2 + A Selector sqrt\n');
    const selector = reads(program, 'Selector')[0];
    expect(nameNeedsExecution(selector)).toBe(false);
    expect(requiresDataOperand(selector)).toBe(true);
    const copy: Expression = { ...selector };
    expect(nameNeedsExecution(copy)).toBe(false);
    expect(requiresDataOperand(copy)).toBe(true);
    // Semantic annotations do not leak into external AST JSON.
    expect(JSON.stringify(copy, (key, value) => key.startsWith('$') ? undefined : value)).not.toContain('annotations');
});

it('recomputes external binding annotations when the same node is regrouped', () => {
    const program = parse('helper\n');
    const node = reads(program, 'helper')[0];
    groupExpressions(program, { bindings: new Map([['helper', [1]]]) });
    expect(nameNeedsExecution(node)).toBe(false);
    groupExpressions(program, { bindings: new Map([['helper', [0]]]) });
    expect(nameNeedsExecution(node)).toBe(true);
    groupExpressions(program, { bindings: new Map([['helper', false]]) });
    expect(nameNeedsExecution(node)).toBe(false);
});

it('returns diagnostics owned by the grouped program without sharing them across parses', () => {
    const program = parse('fun A duplicate A = A\n');
    const result = groupExpressions(program);
    expect(result.program).toBe(program);
    expect(result.diagnostics[0]?.message).toContain('Duplicate function parameter A');
    expect(expressionDiagnostics(program)).toBe(result.diagnostics);
    expect(expressionDiagnostics(parse('5 max 0\n'))).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
});
