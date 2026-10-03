import {
    flattenApplication, isApplicationExpression, isBinaryExpression, isUnaryExpression,
    isNameExpression, isNumberLiteral, isStringLiteral, isArrayExpression,
    type Expression, type Statement,
} from '@arrrank/language';

/** Stable diagnostic categories, never source text, values, or AST references. */
export function compilerRejection(backend: string, node: Expression | Statement, detail?: string): string {
    if (detail) return `${backend}:${detail}:${node.$type}`;
    if (isBinaryExpression(node) || isUnaryExpression(node)) return `${backend}:unsupported-op:${node.operator}`;
    if (isApplicationExpression(node)) {
        const names = flattenApplication(node).filter(isNameExpression);
        if (names.length) return `${backend}:unsupported-op:${names.at(-1)!.name}`;
    }
    if (isNumberLiteral(node)) return `${backend}:unsupported-type:${typeof node.value === 'bigint' ? 'integer' : 'real'}`;
    if (isStringLiteral(node)) return `${backend}:unsupported-type:text`;
    if (isArrayExpression(node)) return `${backend}:unsupported-type:array`;
    return `${backend}:unsupported-node:${node.$type}`;
}
