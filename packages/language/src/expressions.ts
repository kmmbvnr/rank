import { isApplicationExpression, isNameExpression, type Expression } from './generated/ast.js';
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
