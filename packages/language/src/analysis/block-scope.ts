/**
 * Block scope: a name first assigned inside `for`, `if`, `elif`, `else`,
 * `try`, `catch` or `finally` ends with that block. The pass walks statements
 * in source order and reports a read of a name where it does not exist: after
 * its block closed, or before its first assignment — which is how a loop body
 * would otherwise see the previous iteration's value. Names the body never
 * binds — globals of a function, imported or catalogue words — stay silent.
 * With every such read rejected, a runtime can keep a block's values until its
 * outermost block ends without anyone observing the difference.
 */

import { AstUtils, type AstNode } from 'langium';
import {
    isAllAxisExpression, isArrayAssignmentStatement, isAssignmentStatement, isBinaryExpression, isForStatement, isFunctionStatement,
    isIfStatement, isNameExpression, isStatement, isTestStatement, isTryStatement, isUnpackStatement,
    type Expression, type Program, type Statement,
} from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';

/** Names the live preview writes inside blocks and reads after them; they keep flat scope. */
export function isPreviewName(name: string): boolean {
    return name.startsWith('RankReplPreview');
}

export interface BlockScopeDiagnostic {
    readonly node: AstNode;
    readonly message: string;
}

/** The names a `for` header binds: `for I in`, `for Row I in`. */
export function loopNames(condition: Expression | undefined): string[] {
    if (!condition || !isBinaryExpression(condition) || condition.operator !== 'in') return [];
    const parts = flattenApplication(condition.left);
    if (!parts.every(part => isNameExpression(part) || isAllAxisExpression(part))) return [];
    return parts.filter(isNameExpression).map(part => part.name);
}

/** Every name a body binds anywhere outside its nested functions and tests. */
function boundNames(statements: readonly Statement[]): Set<string> {
    const names = new Set<string>();
    const visit = (node: AstNode): void => {
        if (isFunctionStatement(node) || isTestStatement(node)) return;
        // A compound assignment updates a name that must already exist, so it binds nothing.
        if (isAssignmentStatement(node) && node.operator === '=' && !node.name.includes('.')) names.add(node.name);
        else if (isUnpackStatement(node)) node.names.forEach(name => names.add(name));
        else if (isForStatement(node)) loopNames(node.condition).forEach(name => names.add(name));
        else if (isTryStatement(node)) node.catches.forEach(clause => names.add(clause.errorName));
        for (const child of AstUtils.streamContents(node)) visit(child);
    };
    statements.forEach(visit);
    return names;
}

/** `known` names already exist when the program starts, as in a notebook session. */
export function blockScopeDiagnostics(program: Program, known: ReadonlySet<string> = new Set()): BlockScopeDiagnostic[] {
    const diagnostics: BlockScopeDiagnostic[] = [];

    /** Visible names per open block, innermost last, and names whose block ended. */
    function body(statements: readonly Statement[], outer: ReadonlySet<string>[]): void {
        const scopes: Set<string>[] = [...outer as Set<string>[], new Set<string>()];
        const ended = new Map<string, number>();
        const local = boundNames(statements);
        const visible = (name: string) => scopes.some(scope => scope.has(name));
        const bind = (name: string) => {
            if (!visible(name)) scopes.at(-1)!.add(name);
            ended.delete(name);
        };
        const check = (name: string, node: AstNode) => {
            if (isPreviewName(name) || visible(name)) return;
            const line = ended.get(name);
            if (line !== undefined) {
                diagnostics.push({ node, message: `${name} was assigned inside the block that ends at `
                    + `line ${line} and does not exist after it. Assign it before the block to keep it.` });
            } else if (local.has(name)) {
                diagnostics.push({ node, message: `${name} is read before it is assigned. To keep a value `
                    + `between loop iterations, assign it before the loop.` });
            }
        };
        const read = (node: AstNode | undefined) => {
            if (!node) return;
            const nodes = isNameExpression(node) ? [node] : AstUtils.streamAllContents(node).filter(isNameExpression);
            for (const name of nodes) check(name.name, name);
        };
        const block = (statements: readonly Statement[], names: readonly string[], end: AstNode) => {
            const scope = new Set(names.filter(name => !visible(name)));
            scopes.push(scope);
            for (const name of names) ended.delete(name);
            statements.forEach(statement);
            scopes.pop();
            const line = (end.$cstNode?.range.end.line ?? 0) + 1;
            for (const name of scope) if (!visible(name)) ended.set(name, line);
        };
        // A nested function closes over the enclosing body, including names it assigns later.
        const direct = new Set(statements.flatMap(node => isAssignmentStatement(node) ? [node.name]
            : isUnpackStatement(node) ? node.names : []));
        function statement(node: Statement): void {
            if (isFunctionStatement(node)) {
                body(node.statements, [...scopes, direct, new Set(node.parameters)]);
            } else if (isTestStatement(node)) {
                body(node.statements, []);
            } else if (isForStatement(node)) {
                const names = loopNames(node.condition);
                // `for I in Items` binds I rather than reading it.
                read(names.length && isBinaryExpression(node.condition) ? node.condition.right : node.condition);
                block(node.statements, names, node);
            } else if (isIfStatement(node)) {
                read(node.condition);
                for (const clause of node.elifClauses) read(clause.condition);
                block(node.thenStatements, [], node);
                for (const clause of node.elifClauses) block(clause.statements, [], node);
                block(node.elseStatements, [], node);
            } else if (isTryStatement(node)) {
                block(node.statements, [], node);
                for (const clause of node.catches) block(clause.statements, [clause.errorName], node);
                block(node.finallyStatements, [], node);
            } else {
                // Nested statements only appear inside the blocks handled above.
                read(node);
                if ((isAssignmentStatement(node) && node.operator !== '=') || isArrayAssignmentStatement(node)) {
                    check(node.name, node);
                }
                if (isAssignmentStatement(node) && node.operator === '=' && !node.name.includes('.')) bind(node.name);
                else if (isUnpackStatement(node)) node.names.forEach(bind);
            }
        }
        statements.forEach(statement);
    }

    body(program.statements.filter(isStatement), [known]);
    return diagnostics;
}
