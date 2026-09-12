import {
    isApplicationExpression, isArrayExpression, isBinaryExpression, isBooleanLiteral,
    isLabelLiteral, isNameExpression, isNumberLiteral, isParenthesizedExpression,
    isStringLiteral, isUnaryExpression, type Expression,
} from 'rank-language';
import { RankError } from './errors.js';

// An unspellable local makes the receiver lexical, including in lazy results.
export const TABLE_INPUT = '$table';

function application(parts: Expression[]): Expression {
    parts = parts.map(part => isApplicationExpression(part)
        ? { $type: 'ParenthesizedExpression', value: part } as Expression : part);
    return parts.length === 1 ? parts[0] : {
        $type: 'ApplicationExpression', head: parts[0], arguments: parts.slice(1),
    } as Expression;
}

function flatten(expression: Expression): Expression[] {
    return isApplicationExpression(expression)
        ? [...flatten(expression.head), ...expression.arguments] : [expression];
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
        if (isBinaryExpression(node)) return {
            ...node, left: lower(node.left), right: lower(node.right),
            step: node.step ? lower(node.step) : undefined,
        } as Expression;
        if (isArrayExpression(node)) {
            const item = <T extends { value: Expression }>(value: T): T =>
                ({ ...value, value: lower(value.value) });
            return { ...node, items: node.items.map(item), dimensions: node.dimensions.map(item),
                fill: node.fill ? lower(node.fill) : undefined,
                rows: node.rows.map(row => ({ ...row, items: row.items.map(item) })) } as Expression;
        }
        if (isApplicationExpression(node)) {
            const parts = flatten(node);
            // Preserve Rank's infix extrema before applying postfix arities.
            const infix = parts.findIndex((part, index) => index > 0 && index < parts.length - 1
                && isNameExpression(part) && ['min', 'max'].includes(part.name));
            if (infix >= 0) {
                let value = address(parts.slice(0, infix));
                for (let i = infix; i < parts.length; i += 2) {
                    const fn = parts[i];
                    if (!isNameExpression(fn) || !['min', 'max'].includes(fn.name) || !parts[i + 1]) {
                        throw new RankError('min/max chains require alternating values and operations');
                    }
                    callable(fn.name);
                    value = application([value, fn, lower(parts[i + 1])]);
                }
                return value;
            }
            let pending: Expression[] = [];
            for (const part of parts) {
                const arities = isNameExpression(part) ? callable(part.name) : undefined;
                if (!arities) { pending.push(part); continue; }
                const fieldReduction = isNameExpression(part) && ['min', 'max'].includes(part.name)
                    && pending.length > 1 && pending.slice(1).every(isLabelLiteral);
                const arity = fieldReduction ? 1 : arities.includes(pending.length) ? pending.length
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
