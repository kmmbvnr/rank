import type { AstNode } from 'langium';
import { flattenApplication } from '../expressions.js';
import { isBinaryExpression, isFunctionStatement, isNameExpression, isNumberLiteral, isParenthesizedExpression,
    isApplicationExpression, isStatement, type Expression, type Statement } from '../generated/ast.js';

export type NumericUpdateExpression =
    | { kind: 'literal'; value: bigint | number }
    | { kind: 'name'; name: string }
    | { kind: 'select'; name: string; selectors: readonly NumericUpdateExpression[] }
    | { kind: 'binary'; operator: '+' | '-' | '*' | '/' | '//'; left: NumericUpdateExpression; right: NumericUpdateExpression };

/** Syntax candidates only; the runtime must prove numeric storage and addressing. */
export function numericUpdateExpression(expression: Expression, depth = 0): NumericUpdateExpression | undefined {
    if (depth >= 64) return undefined;
    if (isParenthesizedExpression(expression)) return numericUpdateExpression(expression.value, depth + 1);
    if (isNumberLiteral(expression)) return { kind: 'literal', value: expression.value };
    if (isNameExpression(expression) && !expression.name.includes('.')) return { kind: 'name', name: expression.name };
    if (isBinaryExpression(expression) && ['+', '-', '*', '/', '//'].includes(expression.operator)) {
        const left = numericUpdateExpression(expression.left, depth + 1);
        const right = numericUpdateExpression(expression.right, depth + 1);
        return left && right ? { kind: 'binary', operator: expression.operator as '+' | '-' | '*' | '/' | '//', left, right } : undefined;
    }
    if (isApplicationExpression(expression)) {
        const [receiver, ...selectors] = flattenApplication(expression);
        if (!isNameExpression(receiver) || receiver.name.includes('.') || !selectors.length) return undefined;
        const items = selectors.map(item => numericUpdateExpression(item, depth + 1));
        return items.every((item): item is NumericUpdateExpression => item?.kind === 'name' || item?.kind === 'literal')
            ? { kind: 'select', name: receiver.name, selectors: items } : undefined;
    }
    return undefined;
}

/** A later sequential statement replaces this result, including through loops
 * and branches. Function declarations are boundaries: their calls may use it.
 * An optional region boundary excludes statements executed by its caller. */
export function statementResultDiscarded(statement: Statement, boundary?: AstNode): boolean {
    if (boundary) {
        let ancestor: AstNode | undefined = statement;
        for (let depth = 0; ancestor && ancestor !== boundary && depth < 128; depth++) ancestor = ancestor.$container;
        // Detached/synthetic nodes cannot borrow a proof from another region.
        if (ancestor !== boundary) return false;
    }
    for (let current: AstNode = statement, depth = 0; current !== boundary && current.$container && depth < 128; depth++) {
        const parent = current.$container;
        const property = current.$containerProperty;
        const siblings = property && (parent as unknown as Record<string, unknown>)[property];
        if (isStatement(current) && Array.isArray(siblings)) {
            const index = siblings.indexOf(current);
            if (index >= 0 && index < siblings.length - 1 && siblings.slice(index + 1).every(isStatement)) return true;
        }
        if (isFunctionStatement(parent)) return false;
        current = parent;
    }
    return false;
}
