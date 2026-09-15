import {
    isApplicationExpression, isBinaryExpression, isNameExpression, isNumberLiteral,
    type Expression,
} from './generated/ast.js';
import { applicationExpression, flattenApplication, groupedExpression } from './expressions.js';

export const REDUCE_OPERATORS = new Set(['+', '-', '*', '**', '/', '//', '%', 'and', 'or', 'xor']);
export const OUTER_OPERATORS = new Set([
    '+', '-', '*', '**', '/', '//', '%',
    'equal', 'notequal', 'less', 'greater', 'atleast', 'atmost',
    'and', 'or', 'xor', 'multipleby',
]);

function named(expression: Expression | undefined, name: string): boolean {
    return isNameExpression(expression) && expression.name === name;
}

/** The end of a modified call when another pipeline step follows it. */
function boundary(parts: Expression[]): number | undefined {
    const direction = parts.findIndex((part, index) => index > 1
        && (named(part, 'ascending') || named(part, 'descending'))
        && parts.slice(0, index).some(p => named(p, 'sort') || named(p, 'argsort')));
    if (direction >= 0) return direction < parts.length - 1 ? direction + 1 : undefined;
    if (parts.length > 6 && named(parts[1], 'with') && named(parts[3], 'with') && named(parts[5], 'segment')) return 6;
    if (parts.length > 3 && named(parts[2], 'segment')) return 3;
    const rank = parts.findIndex((part, index) => index >= 2 && named(part, 'rank'));
    if (rank >= 0 && parts.length > rank + 2) return rank + 2;
    const axis = parts.findIndex((part, index) => index >= 2 && named(part, 'axis'));
    if (axis >= 0) {
        let end = axis + 1;
        while (end < parts.length && isNumberLiteral(parts[end])) end++;
        if (end > axis + 1 && end < parts.length && !named(parts[end], 'rank')) return end;
    }
    if (parts.length > 4 && named(parts[3], 'outer')) return 4;
    return undefined;
}

/** Fix modifier boundaries in the syntax tree; evaluation only executes them. */
export function groupModifiers(expression: Expression): Expression {
    let prefix: Expression;
    let rest: Expression[];
    if (isBinaryExpression(expression)) {
        const parts = flattenApplication(expression.right);
        const reduce = REDUCE_OPERATORS.has(expression.operator) && named(parts[0], 'reduce');
        const scan = REDUCE_OPERATORS.has(expression.operator) && named(parts[0], 'scan');
        const supported = reduce || scan || (REDUCE_OPERATORS.has(expression.operator)
            && named(parts[0], 'segment'))
            || (OUTER_OPERATORS.has(expression.operator) && named(parts[0], 'outer'));
        if (!supported) return expression;
        const ranked = reduce && named(parts[1], 'rank');
        const seeded = (reduce || scan) && named(parts[ranked ? 3 : 1], 'with');
        const end = (ranked ? 3 : 1) + (seeded ? 2 : 0);
        if (parts.length <= end) return expression;
        prefix = { ...expression, right: applicationExpression(parts.slice(0, end)) } as Expression;
        rest = parts.slice(end);
    } else if (isApplicationExpression(expression)) {
        const parts = flattenApplication(expression);
        const end = boundary(parts);
        if (end === undefined) return expression;
        prefix = applicationExpression(parts.slice(0, end));
        rest = parts.slice(end);
    } else return expression;
    return groupModifiers(applicationExpression([groupedExpression(groupModifiers(prefix)), ...rest], expression));
}
