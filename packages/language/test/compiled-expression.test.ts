import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isAssignmentStatement, isBinaryExpression, isNameExpression, type Program } from '../src/generated/ast.js';
import { compiledScalarTypes, findCompiledOperator, matchCompiledOperatorSignature } from '../src/compiled-operators.js';
import { inferCompiledExpression, type CompiledExpressionContext } from '../src/compiled-expression.js';
import { matchCompiledCallSignature, type CompiledAtomType } from '../src/operations.js';

const services = createRankServices(EmptyFileSystem);
function expression(source: string) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(`Result = ${source}\n`);
    expect(parsed.parserErrors).toEqual([]);
    const statement = parsed.value.statements[0];
    if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
    return statement.value;
}
function context(
    bindings: Readonly<Record<string, CompiledAtomType>> = {}, profile: 'scalarFunction' | 'tensor' = 'scalarFunction',
): CompiledExpressionContext<CompiledAtomType> {
    return {
        types: profile === 'scalarFunction' ? compiledScalarTypes : ['integer', 'real', 'boolean'],
        lookup: name => bindings[name],
        operator: (operation, inputs) => matchCompiledOperatorSignature(operation[profile], inputs),
        budget: { remaining: 128 },
    };
}

describe('shared compiled expression inference', () => {
    it('retains the syntax, child order and selected catalogue overload for lowering', () => {
        const source = expression('(A + 1) less B');
        const result = inferCompiledExpression(source, context({ A: 'integer', B: 'integer' }));
        expect(result.failure).toBeUndefined();
        const node = result.expression!;
        expect(node).toMatchObject({ kind: 'binary', source, type: 'boolean',
            left: { kind: 'group', operand: { kind: 'binary', type: 'integer',
                left: { kind: 'input', name: 'A' }, right: { kind: 'literal', value: 1n } } },
            right: { kind: 'input', name: 'B' } });
        if (node.kind !== 'binary') throw new Error('expected binary tree');
        expect(node.source).toBe(source);
        expect(node.operation).toBe(findCompiledOperator('less'));
        expect(node.signature).toBe(findCompiledOperator('less')!.scalarFunction[0]);
    });

    it('uses the same frontend with consumer-specific numeric domains', () => {
        const source = expression('A + 1.5');
        const restricted = { ...context({ A: 'integer' }), types: ['integer', 'boolean', 'text'] as const };
        expect(inferCompiledExpression(source, restricted).failure?.source.$type).toBe('NumberLiteral');
        for (const profile of ['scalarFunction', 'tensor'] as const) {
            const result = inferCompiledExpression(source, context({ A: 'integer' }, profile));
            expect(result.expression).toMatchObject({ kind: 'binary', type: 'real',
                signature: { inputs: ['integer', 'real'], result: 'real' } });
        }
    });

    it('retains nested native signatures and operand order', () => {
        const scope = { ...context({ X: 'integer' }), call: matchCompiledCallSignature };
        const result = inferCompiledExpression(expression('X text reverse'), scope);
        expect(result.expression).toMatchObject({ kind: 'call', type: 'text', operation: { name: 'reverse' },
            signature: { inputs: ['text'], result: 'text' }, arguments: [
                { kind: 'call', operation: { name: 'text' }, arguments: [{ kind: 'input', name: 'X' }] },
            ] });
    });

    it('requires complete native domains and declines a shadowed spelling', () => {
        for (const [source, bindings] of [
            ['X reverse', { X: 'integer' }],
            ['X reverse', { X: 'text', reverse: 'integer' }],
            ['X Y startswith', { X: 'text', Y: 'bytes' }],
        ] as const) {
            expect(inferCompiledExpression(expression(source), {
                ...context(bindings), call: matchCompiledCallSignature,
            }).failure).toBeDefined();
        }
    });

    it('does not reuse a previous environment when inferring the same syntax', () => {
        const source = expression('A + B');
        const integer = inferCompiledExpression(source, context({ A: 'integer', B: 'integer' }));
        const real = inferCompiledExpression(source, context({ A: 'real', B: 'real' }, 'tensor'));
        const invalid = inferCompiledExpression(source, context({ A: 'boolean', B: 'integer' }));
        expect(integer.expression?.type).toBe('integer');
        expect(real.expression?.type).toBe('real');
        expect(invalid.failure?.source).toBe(source);
        expect(integer.expression?.type).toBe('integer');
    });

    it('reports the first unsupported node without guessing a missing input type', () => {
        const source = expression('Missing + AlsoMissing');
        if (!isBinaryExpression(source)) throw new Error('expected binary expression');
        const reads: string[] = [], scope = context();
        const result = inferCompiledExpression(source, { ...scope, lookup: name => { reads.push(name); return undefined; } });
        expect(result.failure).toEqual({ source: source.left, detail: 'unbound-name' });
        expect(reads).toEqual(['Missing']);
    });

    it('shares the enclosing analysis budget and stops at the first excess node', () => {
        const source = expression('A + B * C'), scope = context({ A: 'integer', B: 'integer', C: 'integer' });
        scope.budget.remaining = 3;
        const result = inferCompiledExpression(source, scope);
        expect(result.failure?.detail).toBe('budget');
        expect(isNameExpression(result.failure!.source) && result.failure!.source.name).toBe('B');
        expect(scope.budget.remaining).toBe(-1);
    });

    it.each(['array 1 2', 'A reverse', 'A to B step 2'])('does not infer outside the current frontend subset: %s', source => {
        expect(inferCompiledExpression(expression(source), context({ A: 'integer', B: 'integer' })).failure).toBeDefined();
    });
});
