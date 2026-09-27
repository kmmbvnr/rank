import { isApplicationExpression, isBinaryExpression, isNameExpression, isNumberLiteral,
    type Expression } from './generated/ast.js';
import { findOperation } from './operations.js';

/** Flatten a call chain without crossing an explicit operand group. */
export function flattenApplication(expression: Expression): Expression[] {
    const parts: Expression[] = [];
    const pending = [expression];
    while (pending.length) {
        const part = pending.pop()!;
        if (isApplicationExpression(part)) {
            for (let index = part.arguments.length - 1; index >= 0; index--) pending.push(part.arguments[index]);
            pending.push(part.head);
        } else parts.push(part);
    }
    return parts;
}

/** The `from` form of `to`/`until` is a slice, not an integer range. */
export function inlineSliceOperands(expression: Expression): {
    source: Expression; start: Expression; end: Expression; axis: bigint; inclusive: boolean;
} | undefined {
    if (!isBinaryExpression(expression) || (expression.operator !== 'to' && expression.operator !== 'until')) return undefined;
    const parts = flattenApplication(expression.left);
    const base = { end: expression.right, inclusive: expression.operator === 'to' };
    if (parts.length === 3 && isNameExpression(parts[1]) && parts[1].name === 'from') {
        return { ...base, source: parts[0], start: parts[2], axis: 0n };
    }
    if (parts.length === 5 && isNameExpression(parts[1]) && parts[1].name === 'axis'
        && isNumberLiteral(parts[2]) && typeof parts[2].value === 'bigint'
        && isNameExpression(parts[3]) && parts[3].name === 'from') {
        return { ...base, source: parts[0], start: parts[4], axis: parts[2].value };
    }
    return undefined;
}

/** Build the same left-associated call structure produced by the grammar. */
export function applicationExpression(parts: readonly Expression[], original?: Expression): Expression {
    return parts.slice(1).reduce((head, argument) => ({
        $type: 'ApplicationExpression', head, arguments: [argument], $cstNode: original?.$cstNode,
    } as Expression), parts[0]);
}

export function groupedExpression(value: Expression): Expression {
    return { $type: 'ParenthesizedExpression', value, $cstNode: value.$cstNode } as Expression;
}

/** Preserve an unbound unary builtin result used as the left operand of a dyadic builtin. */
export function groupedUnaryDyadicChain(expression: Expression, unbound: (name: string) => boolean): Expression | undefined {
    const parts = flattenApplication(expression);
    if (parts.length !== 4 || !isNameExpression(parts[1]) || !isNameExpression(parts[3])) return undefined;
    const unary = findOperation(parts[1].name);
    const dyadic = findOperation(parts[3].name);
    if (!unary || unary.arities.join() !== '1' || !unbound(parts[1].name)
        || !dyadic?.arities.includes(2) || !unbound(parts[3].name)) return undefined;
    return applicationExpression([
        groupedExpression(applicationExpression(parts.slice(0, 2), expression)), parts[2], parts[3],
    ], expression);
}
