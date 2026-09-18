import {
    flattenApplication as flatten, applicationExpression, groupedExpression, COMPARISON_OPERATORS,
    isApplicationExpression, isArrayExpression, isBinaryExpression, isBooleanLiteral,
    isLabelLiteral, isNameExpression, isNumberLiteral, isParenthesizedExpression,
    isStringLiteral, isSubjectComparisonExpression, isUnaryExpression, groupModifiers,
    type Expression,
} from '@arrrank/language';
import { RankError } from './errors.js';

// An unspellable local makes the receiver lexical, including in lazy results.
export const TABLE_INPUT = '$table';

const LOGICAL_OPERATORS = new Set(['and', 'or', 'xor']);

/** True when a condition names a column, which makes it a table query. */
export function readsFields(expression: Expression): boolean {
    if (isLabelLiteral(expression)) return true;
    const children: Expression[] = isApplicationExpression(expression) ? flatten(expression)
        : isBinaryExpression(expression)
            ? [expression.left, expression.right, ...expression.step ? [expression.step] : []]
        : isSubjectComparisonExpression(expression) ? [expression.right]
        : isUnaryExpression(expression) ? [expression.operand]
        : isParenthesizedExpression(expression) ? [expression.value]
        : [];
    return children.some(readsFields);
}

/**
 * The frame axes an explicit `axis` names inside a predicate. A predicate with
 * a cell rank produces one mask value per frame cell, so its frame decides
 * which axes of the source the mask selects along.
 */
export function frameAxes(expression: Expression): number[] {
    const parts = flatten(expression);
    const start = parts.findIndex(part => isNameExpression(part) && part.name === 'axis');
    if (start < 0) return [];
    const axes: number[] = [];
    for (let index = start + 1; index < parts.length; index += 1) {
        const part = parts[index];
        if (!isNumberLiteral(part)) break;
        axes.push(Number(part.value));
    }
    return axes;
}

/**
 * Lower a filter condition over a plain collection. The filtered value is the
 * elided subject: a leading comparison operator takes it as the left operand,
 * and any other leaf is a predicate applied to it. Conditions that already
 * name their own subject are left alone.
 */
export function collectionExpression(expression: Expression): Expression {
    const input = { $type: 'NameExpression', name: TABLE_INPUT } as Expression;

    function lower(node: Expression): Expression {
        if (isSubjectComparisonExpression(node)) {
            return { $type: 'BinaryExpression', left: input, operator: node.operator,
                right: node.right, $cstNode: node.$cstNode } as Expression;
        }
        if (isBinaryExpression(node) && LOGICAL_OPERATORS.has(node.operator)) {
            return { ...node, left: lower(node.left), right: lower(node.right) } as Expression;
        }
        if (isUnaryExpression(node) && node.operator === 'not') {
            return { ...node, operand: lower(node.operand) } as Expression;
        }
        // A binary or parenthesized condition already supplies its own operands.
        if (isBinaryExpression(node) || isParenthesizedExpression(node)) return node;
        // Prepending the subject shifts every modifier, so rebind them here:
        // the program-wide grouping pass has already run.
        return groupModifiers(applicationExpression([input, ...flatten(node)], node));
    }
    return lower(expression);
}

function application(parts: Expression[]): Expression {
    return applicationExpression(parts.map(part => isApplicationExpression(part) ? groupedExpression(part) : part));
}

/** Expand only operand-leading field paths; explicit selectors stay labels. */
export function tableExpression(
    expression: Expression,
    callable: (name: string) => readonly number[] | undefined,
): Expression {
    const ready = new WeakSet<Expression>();
    const input = { $type: 'NameExpression', name: TABLE_INPUT } as Expression;

    function address(parts: Expression[]): Expression {
        if (parts.length === 0) throw new RankError('table expression requires a value');
        return application([lower(parts[0]), ...parts.slice(1).map(part =>
            isLabelLiteral(part) ? part : lower(part))]);
    }

    function lower(node: Expression): Expression {
        if (ready.has(node)) return node;
        if (isLabelLiteral(node)) return application([input, node]);
        if (isNameExpression(node)) { callable(node.name); return node; }
        if (isNumberLiteral(node) || isStringLiteral(node) || isBooleanLiteral(node)) return node;
        if (isParenthesizedExpression(node)) return { ...node, value: lower(node.value) } as Expression;
        if (isUnaryExpression(node)) return { ...node, operand: lower(node.operand) } as Expression;
        if (isBinaryExpression(node)) {
            const modifier = flatten(node.right);
            if (COMPARISON_OPERATORS.has(node.operator) && isNameExpression(modifier[0])
                && ['rank', 'axis'].includes(modifier[0].name)) {
                return { ...node, left: application(flatten(node.left).map(lower)) } as Expression;
            }
            return {
                ...node, left: lower(node.left), right: lower(node.right),
                step: node.step ? lower(node.step) : undefined,
            } as Expression;
        }
        if (isArrayExpression(node)) {
            const item = <T extends { value: Expression }>(value: T): T =>
                ({ ...value, value: lower(value.value) });
            return { ...node, items: node.items.map(item), dimensions: node.dimensions.map(item),
                fill: node.fill ? lower(node.fill) : undefined,
                rows: node.rows.map(row => ({ ...row, items: row.items.map(item) })) } as Expression;
        }
        if (isApplicationExpression(node)) {
            const parts = flatten(node);
            let pending: Expression[] = [];
            for (const part of parts) {
                const arities = isNameExpression(part) ? callable(part.name) : undefined;
                if (!arities) { pending.push(part); continue; }
                const arity = arities.includes(pending.length) ? pending.length
                    : [...arities].sort((a, b) => b - a).find(n => n <= pending.length);
                if (!arity) throw new RankError('operation must follow its data in a table expression');
                const split = pending.length - arity + 1;
                const args = [address(pending.slice(0, split)), ...pending.slice(split).map(lower)];
                const value = application([...args, part]);
                ready.add(value);
                pending = [value];
            }
            return address(pending);
        }
        throw new RankError('table expressions require pure calculations and column access', 'TypeError');
    }
    return lower(expression);
}
