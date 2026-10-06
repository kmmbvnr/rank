import { AstUtils, type AstNode } from 'langium';
import { isBinaryExpression, isCatchClause, isForStatement, isFunctionStatement, isFunctionBindingStatement,
    isNameExpression, isSelectLocal, isUseStatement, type FunctionStatement, type Program } from './generated/ast.js';
import { findOperation } from './operations.js';
import { flattenApplication } from './expressions.js';

/** Unopened library names remain available to user code. */
export function availableBuiltin(name: string, modules: ReadonlySet<string>): boolean {
    if (name === 'type' || name === 'raise') return true;
    // DSU merge remains a contextual graph method even though the public
    // function named merge belongs to sequences.
    if (name === 'merge' && modules.has('graph')) return true;
    const operation = findOperation(name);
    return operation !== undefined && (operation.module === 'core' || modules.has(operation.module));
}

export function builtinBindingMessage(name: string): string {
    return `cannot redefine available builtin: ${name}`;
}

/** Imports apply to declarations throughout a source unit, independent of order. */
export function builtinBindingDiagnostics(
    program: Program, loaded: ReadonlySet<string> = new Set(['core']),
    existing: Iterable<string | FunctionStatement> = [],
    loadModule?: (path: string) => Program | undefined,
): { node: AstNode; kind: 'TypeError'; message: string }[] {
    const nodes = [...AstUtils.streamAllContents(program)];
    const bindings = [...existing];
    for (const binding of bindings) {
        if (typeof binding !== 'string') nodes.push(binding, ...AstUtils.streamAllContents(binding));
    }
    const modules = new Set(loaded);
    for (const node of nodes) if (isUseStatement(node) && node.module) modules.add(node.module);
    const diagnostics: { node: AstNode; kind: 'TypeError'; message: string }[] = [];
    const check = (name: string, node: AstNode): void => {
        if (availableBuiltin(name, modules)) diagnostics.push({ node, kind: 'TypeError',
            message: builtinBindingMessage(name) });
    };
    for (const binding of bindings) if (typeof binding === 'string') check(binding, program);
    for (const node of nodes) {
        if (isFunctionStatement(node) || isFunctionBindingStatement(node)) {
            check(node.name, node);
            for (const parameter of node.parameters) check(parameter, node);
        } else if (isForStatement(node) && isBinaryExpression(node.condition)
            && node.condition.operator === 'in') {
            for (const part of flattenApplication(node.condition.left)) {
                if (isNameExpression(part)) check(part.name, node);
            }
        } else if (isCatchClause(node)) check(node.errorName, node);
        else if (isSelectLocal(node)) check(node.name, node);
        else if (isUseStatement(node)) {
            if (node.alias) check(node.alias, node);
            else if (node.path && loadModule) {
                const imported = loadModule(node.path);
                for (const declaration of imported?.statements ?? []) {
                    if (isFunctionStatement(declaration) || isFunctionBindingStatement(declaration)) check(declaration.name, node);
                }
            }
        }
    }
    return diagnostics;
}
