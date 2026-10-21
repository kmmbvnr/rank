import { AstUtils, EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import {
    analyzeBindings, createRankServices, functionCallSignature,
    isAssignmentStatement, isDeclaredCallExpression, isFunctionStatement, isNameExpression,
    type Program,
} from '../src/index.js';

import { functionDeclarationErrors } from '../src/function-declaration.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
function parse(source: string): Program {
    const result = parser.parse<Program>(source);
    expect(result.lexerErrors).toEqual([]);
    expect(result.parserErrors).toEqual([]);
    return result.value;
}

describe('binding evaluation modes', () => {
    it('keeps the assignment marker separate from the referenced name', () => {
        const program = parse("Source' = 1 to 10\nSaved = Source\nTotal' = Source sum\nTotal");
        const assignments = program.statements.filter(isAssignmentStatement);
        expect(assignments.map(({ name, deferred, operator }) => ({ name, deferred, operator }))).toEqual([
            { name: 'Source', deferred: true, operator: '=' },
            { name: 'Saved', deferred: false, operator: '=' },
            { name: 'Total', deferred: true, operator: '=' },
        ]);
        const facts = analyzeBindings(program);
        expect(facts.words).toEqual([]);
        const bindings = facts.scopes[0].bindings;
        expect(bindings.map(binding => binding.name)).toEqual(['Source', 'Saved', 'Total']);
        expect(bindings.find(binding => binding.name === 'Source')?.reads).toHaveLength(2);
        expect(bindings.find(binding => binding.name === 'Total')?.reads).toHaveLength(1);
    });

    it('accepts whitespace around a binding marker', () => {
        const [binding] = parse("Source ' = 1 to 10").statements;
        expect(binding).toMatchObject({ name: 'Source', deferred: true });
    });

    it.each([
        "A = B'", "A' += 1", "A' 0 = 1", "A 0' = 1", "A'' = 1", "'A = 1",
        "fun X'' f = X", "fun X f = X'",
    ])('rejects apostrophes outside binding sites: %s', source => {
        const result = parser.parse<Program>(source);
        expect(result.lexerErrors.length + result.parserErrors.length).toBeGreaterThan(0);
    });

    it('carries mixed left, right and group parameter modes into call signatures', () => {
        const program = parse([
            "fun X' Y blend Z' callback .offset Offset' = 0",
            '  return (X + Y + Z + Offset) callback',
            'end',
            'Result = 1 2 blend 3 abs offset 4',
        ].join('\n'));
        const definition = program.statements.find(isFunctionStatement)!;
        expect(definition.parameters).toEqual(['X', 'Y', 'Z', 'callback', 'Offset']);
        expect(definition.leftParameters).toEqual(['X', 'Y']);
        expect(definition.rightParameters).toEqual(['Z', 'callback']);
        const signature = functionCallSignature(definition);
        expect(signature.parameters.map(({ name, deferred, kind }) => ({ name, deferred, kind }))).toEqual([
            { name: 'X', deferred: true, kind: 'data' },
            { name: 'Y', deferred: false, kind: 'data' },
            { name: 'Z', deferred: true, kind: 'data' },
            { name: 'callback', deferred: false, kind: 'function' },
            { name: 'Offset', deferred: true, kind: 'option' },
        ]);
        expect(signature.words).toMatchObject([{ word: 'offset', parameter: 4 }]);
        const calls = [...AstUtils.streamAllContents(program)].filter(isDeclaredCallExpression);
        expect(calls).toHaveLength(1);
        expect(calls[0].arguments).toHaveLength(5);
        for (const node of AstUtils.streamAllContents(program)) {
            if (isNameExpression(node)) expect(node.name).not.toContain("'");
        }
        expect(analyzeBindings(program).words).toEqual([]);
    });

    it('preserves contextual operator arguments and multiline groups after markers', () => {
        const program = parse([
            "fun X' fold callback",
            "  .seed Seed' = 0",
            '  return X Seed callback',
            'end',
            'Result = 1 fold + seed 2',
        ].join('\n'));
        const definition = program.statements.find(isFunctionStatement)!;
        expect(functionCallSignature(definition).parameters.map(parameter => parameter.deferred))
            .toEqual([true, false, true]);
        const call = [...AstUtils.streamAllContents(program)].find(isDeclaredCallExpression)!;
        expect(call.arguments[1]).toMatchObject({ $type: 'FunctionOperator', operator: '+' });
    });

    it('resolves apostrophe parameters as local bindings and preserves AST containers', () => {
        const program = parse("fun X' stats = X sum\nResult = (1 to 4) stats");
        const facts = analyzeBindings(program);
        expect(facts.words).toEqual([]);
        expect(facts.scopes.find(scope => scope.name === 'stats')?.bindings)
            .toMatchObject([{ name: 'X', kind: 'parameter', unused: false }]);
        for (const node of AstUtils.streamAst(program)) {
            for (const child of AstUtils.streamContents(node)) expect(child.$container).toBe(node);
        }
    });

    it('diagnoses duplicate parameter names regardless of their modes', () => {
        const program = parse("fun X' f X = X");
        const definition = program.statements.find(isFunctionStatement)!;
        expect(functionDeclarationErrors(definition)).toContain('Duplicate function parameter X');
    });
});
