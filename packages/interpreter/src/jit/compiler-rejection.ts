import {
    flattenApplication, isExpressionStatement, isApplicationExpression, isBinaryExpression, isUnaryExpression,
    isNameExpression, isNumberLiteral, isStringLiteral, isArrayExpression, isFunctionStatement,
    type Expression, type Statement,
} from '@arrrank/language';
import { currentDiagnostics, recordFallback } from '../diagnostics.js';
import { sourceIdOf } from '../source-location.js';

/** A bounded syntax snapshot, with no AST, runtime values or invocation frames. */
export interface CompilerRejection {
    readonly sourceId?: string;
    readonly reason: string;
    readonly node: string;
    readonly name?: string;
    readonly function?: string;
    readonly expression?: string;
    readonly line?: number;
    readonly column?: number;
}

export function describeCompilerRejection(backend: string, node: Expression | Statement, detail?: string): CompilerRejection {
    let owner = node.$container;
    while (owner && !isFunctionStatement(owner)) owner = owner.$container;
    const cst = node.$cstNode;
    return {
        reason: compilerRejection(backend, node, detail), node: node.$type,
        name: isNameExpression(node) ? node.name : undefined,
        function: owner && isFunctionStatement(owner) ? owner.name : undefined,
        sourceId: cst && sourceIdOf(cst, '<input>'),
        expression: cst?.text.slice(0, 160),
        line: cst && cst.range.start.line + 1, column: cst && cst.range.start.character + 1,
    };
}

export function recordCompilerRejection(failure: CompilerRejection): undefined {
    rememberCompilerRejection(failure);
    return recordFallback(failure.reason);
}

/** Capture candidate failures without changing existing fallback counters. */
export function rememberCompilerRejection(failure: CompilerRejection): void {
    currentDiagnostics()?.rememberCompilerRejection(failure);
}

/** Stable diagnostic categories, never source text, values, or AST references. */
export function compilerRejection(backend: string, node: Expression | Statement, detail?: string): string {
    if (detail) return `${backend}:${detail}:${node.$type}`;
    if (isExpressionStatement(node)) return compilerRejection(backend, node.value);
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
