import {
    isParenthesizedExpression, isNumberLiteral, isBooleanLiteral, isStringLiteral,
    isNameExpression, isUnaryExpression, isBinaryExpression, isApplicationExpression, type Expression,
} from './generated/ast.js';
import { findCompiledOperator, type CompiledOperator } from './compiled-operators.js';
import { findOperation, type Operation, type CompiledAtomType, type CompiledCallSignature } from './operations.js';
import { applicationForm, symbolicApplicationForm } from './application-forms.js';
import { applicationExpression, flattenApplication, groupedUnaryDyadicChain, unaryApplicationHead } from './expressions.js';

interface TypedNode<T> {
    readonly source: Expression;
    readonly type: T;
}

/** A compiler proof tree. It retains evaluation order and catalogue overloads;
 * it contains no runtime values, readers, frames or speculative type facts. */
export type CompiledExpression<T = CompiledAtomType, Input = string> = TypedNode<T> & (
    | { readonly kind: 'literal'; readonly value: bigint | number | boolean | string }
    | { readonly kind: 'input'; readonly input: Input }
    | { readonly kind: 'group'; readonly operand: CompiledExpression<T, Input> }
    | { readonly kind: 'unary'; readonly operation: CompiledOperator;
        readonly signature: CompiledExpressionSignature<T>; readonly operand: CompiledExpression<T, Input> }
    | { readonly kind: 'call'; readonly operation: Operation; readonly signature: CompiledCallSignature;
        readonly arguments: readonly CompiledExpression<T, Input>[] }
    | { readonly kind: 'extreme'; readonly name: 'min' | 'max';
        readonly left: CompiledExpression<T, Input>; readonly right?: CompiledExpression<T, Input>;
        /** Number of raw values grouped by argument selection, for error context. */
        readonly selected?: number }
    | { readonly kind: 'binary'; readonly operation: CompiledOperator;
        readonly signature: CompiledExpressionSignature<T>;
        readonly left: CompiledExpression<T, Input>; readonly right: CompiledExpression<T, Input> }
);

export interface CompiledExpressionSignature<T> {
    readonly inputs: readonly T[];
    readonly result: T;
}

export interface CompiledExpressionContext<T, Input = string> {
    /** Represent a known atom in the consumer domain; unsupported atoms are not coerced. */
    readonly atom: (type: CompiledAtomType) => T | undefined;
    /** Consumer-proved inputs: slots, cell reads or other guarded operations.
     * The payload is lowering metadata, never a value observed by this pass. */
    readonly read: (source: Expression, hint?: T) => { readonly type: T; readonly input: Input } | undefined;
    /** Whether a spelling is bound locally, independent of its scalar type. */
    readonly isBound: (name: string) => boolean;
    /** Additional entry-guarded scalar slots; excludes implicit nullary calls. */
    readonly scalarSlot?: (name: string) => boolean;
    /** Optional input-domain hints. The consumer must guard each selected input. */
    readonly operandHint?: (source: Expression, index: 0 | 1, left?: T) => T | undefined;
    /** Select the consumer's declared overload, including its capability gates. */
    readonly operator: (operation: CompiledOperator, inputs: readonly T[]) => CompiledExpressionSignature<T> | undefined;
    /** Optional native call capability. Runtime binding identity remains an entry guard. */
    readonly call?: (operation: Operation, inputs: readonly T[]) => CompiledCallSignature | undefined;
    /** Scalar extrema only; consumers prove the operand domains and guard the builtin. */
    readonly extreme?: (name: 'min' | 'max', inputs: readonly T[]) => T | undefined;
    /** Share a finite analysis budget with the enclosing statement analysis. */
    readonly budget: { remaining: number };
}

export type CompiledExpressionResult<T, Input = string> =
    | { readonly expression: CompiledExpression<T, Input>; readonly failure?: never }
    | { readonly expression?: never; readonly failure: { readonly source: Expression; readonly detail?: string } };

/** Scalar extrema and left-associated chains such as `A B max C min`.
 * Collection reductions use the ordinary call path when scalar proof fails. */
function scalarExtremeParts(source: Expression, unbound: (name: string) => boolean): {
    name: 'min' | 'max'; left: Expression; right?: Expression; selected?: number;
} | undefined {
    if (!isApplicationExpression(source)) return undefined;
    const parts = flattenApplication(source);
    const isExtreme = (part: Expression | undefined) => isNameExpression(part)
        && (part.name === 'min' || part.name === 'max') && unbound(part.name);
    const last = parts.at(-1);
    if (!isNameExpression(last) || last.name !== 'min' && last.name !== 'max' || !unbound(last.name)) return undefined;
    const name = last.name;
    if (parts.length === 2 && !isExtreme(parts[0])) return { name, left: parts[0] };
    if (parts.length === 3 && !isExtreme(parts[0]) && !isExtreme(parts[1])) {
        return { name, left: parts[0], right: parts[1] };
    }
    if (parts.length > 3 && !isExtreme(parts.at(-2))) {
        const left = applicationExpression(parts.slice(0, -2), source);
        const right = parts.at(-2)!;
        // Argument preparation selects the addressed left operand only after
        // evaluating the remaining data. A proved scalar slot or literal has
        // no effects or errors to reorder across that selection. Other right
        // operands retain ordinary evaluation unless the left is a completed
        // extrema chain, whose result is already evaluated before the right.
        if (scalarExtremeParts(left, unbound)) return { name, left, right };
        if (isNameExpression(right) || isNumberLiteral(right)) return { name, left, right, selected: parts.length - 2 };
    }
    return undefined;
}

/** Infer once, then let backends lower the proved tree. This is the common
 * atomic-expression frontend; storage/layout and binding identity remain
 * consumer guards. Unknown names and syntax never acquire guessed types.
 * A failure identifies the first unsupported node in source evaluation order. */
export function inferCompiledExpression<T, Input>(
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
        const type = context.atom(actual);
        return type !== undefined ? { expression: { kind: 'literal', source, type, value: source.value } } : reject();
    }
    const extreme = context.extreme && scalarExtremeParts(source, name => !context.isBound(name));
    if (extreme) {
        const left = inferCompiledExpression(extreme.left, context);
        if (left.failure) return left;
        const right = extreme.right ? inferCompiledExpression(extreme.right, context) : undefined;
        if (right?.failure) return right;
        if (extreme.selected && extreme.right && isNameExpression(extreme.right)
            && !context.isBound(extreme.right.name) && !context.scalarSlot?.(extreme.right.name)) return reject();
        const type = context.extreme!(extreme.name, right ? [left.expression.type, right.expression.type] : [left.expression.type]);
        if (type !== undefined) return { expression: { kind: 'extreme', source, type, name: extreme.name,
            left: left.expression, right: right?.expression, selected: extreme.selected } };
        return reject();
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
        const type = signature && context.atom(signature.result);
        return signature && type !== undefined ? { expression: { kind: 'call', source, type, operation, signature, arguments: arguments_ } }
            : reject();
    }
    return reject();
}
