import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isAssignmentStatement, isApplicationExpression, isBinaryExpression, isNameExpression, type Program } from '../src/generated/ast.js';
import { compiledScalarTypes, findCompiledOperator, matchCompiledOperatorSignature, matchCompiledOperatorDomains } from '../src/compiled-operators.js';
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
        atom: type => (profile === 'scalarFunction' ? compiledScalarTypes : ['integer', 'real', 'boolean'] as const)
            .find(candidate => candidate === type),
        read: source => isNameExpression(source) && bindings[source.name]
            ? { type: bindings[source.name], input: source.name } : undefined,
        isBound: name => Object.prototype.hasOwnProperty.call(bindings, name),
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
                left: { kind: 'input', input: 'A' }, right: { kind: 'literal', value: 1n } } },
            right: { kind: 'input', input: 'B' } });
        if (node.kind !== 'binary') throw new Error('expected binary tree');
        expect(node.source).toBe(source);
        expect(node.operation).toBe(findCompiledOperator('less'));
        expect(node.signature).toBe(findCompiledOperator('less')!.scalarFunction[0]);
    });

    it('retains consumer-proved read metadata without executing it', () => {
        const source = expression('(Values 0) + 1');
        const payload = { slot: 4, dimensions: [2], reader: 'reader4' };
        let inputs = 0;
        const result = inferCompiledExpression(source, {
            ...context(),
            read: node => {
                if (!isApplicationExpression(node)) return undefined;
                inputs++;
                return { type: 'integer' as const, input: payload };
            },
        });
        expect(inputs).toBe(1);
        expect(result.expression).toMatchObject({ kind: 'binary', type: 'integer',
            left: { kind: 'group', operand: { kind: 'input', input: payload } } });
        const node = result.expression!;
        if (node.kind !== 'binary' || node.left.kind !== 'group' || node.left.operand.kind !== 'input') {
            throw new Error('expected a guarded read');
        }
        expect(node.left.operand.input).toBe(payload);
    });

    it('passes input hints through grouping and uses the proven left type for the right hint', () => {
        const seen: [string, CompiledAtomType | undefined][] = [];
        const result = inferCompiledExpression(expression('(Flag) and Other'), {
            ...context(),
            operandHint: (_source, index, left) => index === 0 ? 'boolean' : left,
            read: (node, hint) => {
                if (!isNameExpression(node)) return undefined;
                seen.push([node.name, hint]);
                return hint ? { type: hint, input: node.name } : undefined;
            },
        });
        expect(result.expression?.type).toBe('boolean');
        expect(seen).toEqual([['Flag', 'boolean'], ['Other', 'boolean']]);
    });

    it('distinguishes symbolic modifiers from bound scalar operands', () => {
        const source = expression('A + reduce');
        expect(inferCompiledExpression(source, context({ A: 'integer' })).failure)
            .toEqual({ source, detail: 'application-form' });
        expect(inferCompiledExpression(source, context({ A: 'integer', reduce: 'integer' })).expression?.type)
            .toBe('integer');
    });

    it('keeps unresolved numeric possibilities until an operation fixes the result domain', () => {
        const scope: CompiledExpressionContext<readonly CompiledAtomType[]> = {
            atom: type => [type],
            read: node => isNameExpression(node) ? { type: ['integer', 'real'], input: node.name } : undefined,
            isBound: () => true,
            operator: (operation, inputs) => matchCompiledOperatorDomains(operation.tensor, inputs),
            budget: { remaining: 128 },
        };
        expect(inferCompiledExpression(expression('A + 1'), scope).expression?.type).toEqual(['integer', 'real']);
        expect(inferCompiledExpression(expression('A / B'), scope).expression?.type).toEqual(['real']);
        expect(inferCompiledExpression(expression('A less B'), scope).expression?.type).toEqual(['boolean']);
        expect(inferCompiledExpression(expression('A and B'), scope).failure).toBeDefined();
    });

    it('uses the same frontend with consumer-specific numeric domains', () => {
        const source = expression('A + 1.5');
        const restricted = { ...context({ A: 'integer' }), atom: (type: CompiledAtomType) => (['integer', 'boolean', 'text'] as const).find(candidate => candidate === type) };
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
                { kind: 'call', operation: { name: 'text' }, arguments: [{ kind: 'input', input: 'X' }] },
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
        const result = inferCompiledExpression(source, { ...scope, read: source => { if (isNameExpression(source)) reads.push(source.name); return undefined; } });
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
