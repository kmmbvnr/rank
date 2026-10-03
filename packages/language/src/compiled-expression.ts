import {
    isParenthesizedExpression, isNumberLiteral, isBooleanLiteral, isStringLiteral,
    isNameExpression, isUnaryExpression, isBinaryExpression, isApplicationExpression, type Expression,
} from './generated/ast.js';
import { findCompiledOperator, type CompiledOperator, type CompiledOperatorSignature } from './compiled-operators.js';
import { findOperation, type Operation, type CompiledAtomType, type CompiledCallSignature } from './operations.js';
import { applicationForm, symbolicApplicationForm } from './application-forms.js';
import { flattenApplication, groupedUnaryDyadicChain, unaryApplicationHead } from './expressions.js';

interface TypedNode<T extends CompiledAtomType> {
    readonly source: Expression;
    readonly type: T;
}

/** A compiler proof tree. It retains evaluation order and catalogue overloads;
 * it contains no runtime values, readers, frames or speculative type facts. */
export type CompiledExpression<T extends CompiledAtomType = CompiledAtomType, Input = string> = TypedNode<T> & (
    | { readonly kind: 'literal'; readonly value: bigint | number | boolean | string }
    | { readonly kind: 'input'; readonly input: Input }
    | { readonly kind: 'group'; readonly operand: CompiledExpression<T, Input> }
    | { readonly kind: 'unary'; readonly operation: CompiledOperator;
        readonly signature: CompiledOperatorSignature<T>; readonly operand: CompiledExpression<T, Input> }
    | { readonly kind: 'call'; readonly operation: Operation; readonly signature: CompiledCallSignature;
        readonly arguments: readonly CompiledExpression<T, Input>[] }
    | { readonly kind: 'binary'; readonly operation: CompiledOperator;
        readonly signature: CompiledOperatorSignature<T>;
        readonly left: CompiledExpression<T, Input>; readonly right: CompiledExpression<T, Input> }
);

export interface CompiledExpressionContext<T extends CompiledAtomType, Input = string> {
    /** Literal domains supported by the consumer. Other values are not coerced. */
    readonly types: readonly T[];
    /** Consumer-proved inputs: slots, cell reads or other guarded operations.
     * The payload is lowering metadata, never a value observed by this pass. */
    readonly read: (source: Expression, hint?: T) => { readonly type: T; readonly input: Input } | undefined;
    /** Whether a spelling is bound locally, independent of its scalar type. */
    readonly isBound: (name: string) => boolean;
    /** Optional input-domain hints. The consumer must guard each selected input. */
    readonly operandHint?: (source: Expression, index: 0 | 1, left?: T) => T | undefined;
    /** Select the consumer's declared overload, including its capability gates. */
    readonly operator: (operation: CompiledOperator, inputs: readonly T[]) => CompiledOperatorSignature<T> | undefined;
    /** Optional native call capability. Runtime binding identity remains an entry guard. */
    readonly call?: (operation: Operation, inputs: readonly T[]) => CompiledCallSignature | undefined;
    /** Share a finite analysis budget with the enclosing statement analysis. */
    readonly budget: { remaining: number };
}

export type CompiledExpressionResult<T extends CompiledAtomType, Input = string> =
    | { readonly expression: CompiledExpression<T, Input>; readonly failure?: never }
    | { readonly expression?: never; readonly failure: { readonly source: Expression; readonly detail?: string } };

/** Infer once, then let backends lower the proved tree. This is the common
 * atomic-expression frontend; storage/layout and binding identity remain
 * consumer guards. Unknown names and syntax never acquire guessed types.
 * A failure identifies the first unsupported node in source evaluation order. */
export function inferCompiledExpression<T extends CompiledAtomType, Input>(
    source: Expression, context: CompiledExpressionContext<T, Input>, hint?: T,
): CompiledExpressionResult<T, Input> {
    const reject = (detail?: string): CompiledExpressionResult<T, Input> => ({ failure: { source, detail } });
    if (--context.budget.remaining < 0) return reject('budget');
    if (isParenthesizedExpression(source)) {
        const result = inferCompiledExpression(source.value, context, hint);
        if (result.failure) return result;
        const operand = result.expression;
        return { expression: { kind: 'group', source, type: operand.type, operand } };
    }
    if (isNumberLiteral(source) || isBooleanLiteral(source) || isStringLiteral(source)) {
        const actual = typeof source.value === 'bigint' ? 'integer'
            : typeof source.value === 'number' ? 'real' : typeof source.value === 'boolean' ? 'boolean' : 'text';
        const type = context.types.find(type => type === actual);
        return type ? { expression: { kind: 'literal', source, type, value: source.value } } : reject();
    }
    const input = context.read(source, hint);
    if (input) return { expression: { kind: 'input', source, ...input } };
    if (symbolicApplicationForm(source, name => !context.isBound(name))) return reject('application-form');
    if (isNameExpression(source)) return reject('unbound-name');
    if (isUnaryExpression(source)) {
        const result = inferCompiledExpression(source.operand, context, context.operandHint?.(source, 0));
        if (result.failure) return result;
        const operand = result.expression, operation = findCompiledOperator(source.operator);
        const signature = operation && context.operator(operation, [operand.type]);
        return operation && signature
            ? { expression: { kind: 'unary', source, type: signature.result, operation, signature, operand } } : reject();
    }
    if (isBinaryExpression(source) && !source.step) {
        const a = inferCompiledExpression(source.left, context, context.operandHint?.(source, 0));
        if (a.failure) return a;
        const b = inferCompiledExpression(source.right, context, context.operandHint?.(source, 1, a.expression.type));
        if (b.failure) return b;
        const left = a.expression, right = b.expression, operation = findCompiledOperator(source.operator);
        const signature = operation && context.operator(operation, [left.type, right.type]);
        return operation && signature
            ? { expression: { kind: 'binary', source, type: signature.result, operation, signature, left, right } } : reject();
    }
    if (isApplicationExpression(source) && context.call) {
        const unbound = (name: string) => !context.isBound(name);
        const lookup = (name: string) => unbound(name) ? findOperation(name) : false;
        if (applicationForm(source, lookup).kind !== 'plain') return reject('application-form');
        const grouped = groupedUnaryDyadicChain(source, unbound);
        if (grouped) return inferCompiledExpression(grouped, context);
        const head = unaryApplicationHead(source, name => { const operation = lookup(name); return operation ? operation.arities : undefined; }, unbound);
        const parts = head ? [head, source.arguments[0]] : flattenApplication(source);
        const last = parts.at(-1);
        if (!isNameExpression(last) || !unbound(last.name)) return reject('callee-binding');
        const operation = findOperation(last.name);
        if (!operation?.compiledCall) return reject();
        const arguments_: CompiledExpression<T, Input>[] = [];
        for (const part of parts.slice(0, -1)) {
            const inferred = inferCompiledExpression(part, context);
            if (inferred.failure) return inferred;
            arguments_.push(inferred.expression);
        }
        const signature = context.call(operation, arguments_.map(argument => argument.type));
        const type = signature && context.types.find(type => type === signature.result);
        return signature && type ? { expression: { kind: 'call', source, type, operation, signature, arguments: arguments_ } }
            : reject();
    }
    return reject();
}
