import {
    isApplicationExpression, isBinaryExpression, isLabelLiteral, isNameExpression, isNumberLiteral,
    type Expression, type NameExpression,
} from './generated/ast.js';
import { applicationExpression, flattenApplication, groupedExpression } from './expressions.js';
import { findOperation } from './operations.js';

export const COMPARISON_OPERATORS = new Set(['equal', 'notequal', 'less', 'greater', 'atleast', 'atmost']);

export const REDUCE_OPERATORS = new Set(['+', '-', '*', '**', '/', '//', '%', 'and', 'or', 'xor']);
export const OUTER_OPERATORS = new Set([
    '+', '-', '*', '**', '/', '//', '%',
    'equal', 'notequal', 'less', 'greater', 'atleast', 'atmost',
    'and', 'or', 'xor', 'multipleby',
]);

function named(expression: Expression | undefined, name: string): boolean {
    return isNameExpression(expression) && expression.name === name;
}

function isSortDirection(expression: Expression | undefined): boolean {
    return isLabelLiteral(expression)
        && (expression.name === 'ascending' || expression.name === 'descending');
}

/**
 * `Text json .flat`: a label after an operation that declares it as a modifier
 * chooses the form of that call's result rather than reading a field of it.
 * Returns the position of the operation name.
 */
function declaredModifier(parts: Expression[], standard: StandardName): number | undefined {
    const index = parts.findIndex((part, position) => {
        const label = parts[position + 1];
        return position > 0 && isNameExpression(part) && isLabelLiteral(label) && standard(part)
            && !!findOperation(part.name)?.modifiers?.includes(label.name);
    });
    return index >= 0 ? index : undefined;
}

/** The end of a modified call when another pipeline step follows it. */
function boundary(parts: Expression[]): number | undefined {
    const direction = parts.findIndex((part, index) => index > 1
        && isSortDirection(part)
        && parts.slice(0, index).some(p => named(p, 'sort') || named(p, 'argsort')));
    if (direction >= 0) return direction < parts.length - 1 ? direction + 1 : undefined;
    if (named(parts[2], 'segment') || named(parts[2], 'scan')) {
        const end = named(parts[3], 'with') ? 5 : 3;
        return parts.length > end ? end : undefined;
    }
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

/** Whether a name at this site is the standard operation rather than a program binding. */
export type StandardName = (name: NameExpression) => boolean;

/** Fix modifier boundaries in the syntax tree; evaluation only executes them. */
export function groupModifiers(expression: Expression, standard: StandardName = () => true): Expression {
    let prefix: Expression;
    let rest: Expression[];
    if (isBinaryExpression(expression)) {
        const parts = flattenApplication(expression.right);
        const reduce = REDUCE_OPERATORS.has(expression.operator) && named(parts[0], 'reduce');
        const scan = REDUCE_OPERATORS.has(expression.operator) && named(parts[0], 'scan');
        const comparison = COMPARISON_OPERATORS.has(expression.operator)
            && (named(parts[0], 'rank') || named(parts[0], 'axis'));
        const supported = comparison || reduce || scan || (REDUCE_OPERATORS.has(expression.operator)
            && named(parts[0], 'segment'))
            || (OUTER_OPERATORS.has(expression.operator) && named(parts[0], 'outer'));
        if (!supported) return expression;
        const ranked = reduce && named(parts[1], 'rank');
        const seeded = (reduce || scan) && named(parts[ranked ? 3 : 1], 'with');
        const rankPosition = comparison ? parts.findIndex(part => named(part, 'rank')) : -1;
        if (comparison && rankPosition < 0) return expression;
        const end = comparison ? rankPosition + 2 : (ranked ? 3 : 1) + (seeded ? 2 : 0);
        if (parts.length <= end) return expression;
        prefix = { ...expression, right: applicationExpression(parts.slice(0, end)) } as Expression;
        rest = parts.slice(end);
    } else if (isApplicationExpression(expression)) {
        const parts = flattenApplication(expression);
        const modified = declaredModifier(parts, standard);
        if (modified !== undefined) {
            // The label becomes the call's last operand, after the data it reads.
            const operand = modified > 1 ? groupedExpression(groupModifiers(applicationExpression(parts.slice(0, modified)), standard))
                : parts[0];
            const call = applicationExpression([operand, parts[modified + 1], parts[modified]], expression);
            const rest = parts.slice(modified + 2);
            return rest.length ? groupModifiers(applicationExpression([groupedExpression(call), ...rest], expression), standard) : call;
        }
        const end = boundary(parts);
        if (end === undefined) return expression;
        prefix = applicationExpression(parts.slice(0, end));
        rest = parts.slice(end);
    } else return expression;
    return groupModifiers(applicationExpression([groupedExpression(groupModifiers(prefix, standard)), ...rest], expression), standard);
}
