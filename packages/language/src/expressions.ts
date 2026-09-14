import { isApplicationExpression, type Expression } from './generated/ast.js';

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
