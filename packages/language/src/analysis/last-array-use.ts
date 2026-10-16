import { AstUtils, type AstNode } from 'langium';
import {
    isArrayAssignmentStatement, isAssignmentStatement, isExpressionStatement, isFunctionBindingStatement, isFunctionStatement,
    isNameExpression, isParenthesizedExpression, isReturnStatement, isTryStatement, isYieldStatement,
    type Expression, type FunctionStatement,
} from '../generated/ast.js';

const cache = new WeakMap<Expression, readonly (string | undefined)[]>();

/** Last whole-value uses in a direct statement of a nonescaping function frame.
 * This proves only the caller's continuation; storage uniqueness and call identity
 * must still be checked at runtime.
 */
export function lastArrayUseArguments(expression: Expression, arguments_: readonly Expression[]): readonly (string | undefined)[] {
    const cached = cache.get(expression);
    if (cached) return cached;
    const result = analyze(expression, arguments_);
    cache.set(expression, result);
    return result;
}

function analyze(expression: Expression, arguments_: readonly Expression[]): readonly (string | undefined)[] {
    let root: AstNode = expression;
    while (isParenthesizedExpression(root.$container)) root = root.$container;
    const statement = root.$container;
    if (!(isReturnStatement(statement) || isAssignmentStatement(statement) || isExpressionStatement(statement))
        || statement.value !== root) return [];
    const caller = statement.$container;
    if (!isFunctionStatement(caller)) return [];
    const nodes = [...AstUtils.streamAllContents(caller)];
    // A closure can retain the frame without making another array binding.
    // Protected exits and suspended bodies need a separate liveness proof.
    if (nodes.some(node => isFunctionStatement(node) || isFunctionBindingStatement(node)
        || isTryStatement(node) || isYieldStatement(node))) return [];
    const index = caller.statements.indexOf(statement);
    if (index < 0) return [];
    const later = caller.statements.slice(index + 1).flatMap(item => [item, ...AstUtils.streamAllContents(item)]);
    const uses = [statement, ...AstUtils.streamAllContents(statement)];
    return arguments_.map(argument => {
        while (isParenthesizedExpression(argument)) argument = argument.value;
        if (!isNameExpression(argument)) return undefined;
        const name = argument.name;
        if (name.includes('.')
            || isAssignmentStatement(statement) && statement.name === name) return undefined;
        // Own locals only. A captured or global binding is still observable.
        if (!caller.parameters.includes(name)
            && !caller.statements.slice(0, index).some(item => isAssignmentStatement(item) && item.name === name)) return undefined;
        // An earlier unclassified call may retain a local through a host callback
        // without creating a Rank binding. Only construction and addressed writes
        // may precede this first whole-value use in the initial proof.
        if (caller.statements.slice(0, index).some(item =>
            [...AstUtils.streamAllContents(item)].some(node => isNameExpression(node) && node.name === name))) return undefined;
        if (uses.filter(node => isNameExpression(node) && node.name === name).length !== 1) return undefined;
        if (later.some(node => 'name' in node && node.name === name)) return undefined;
        return name;
    });
}

const writes = new WeakMap<FunctionStatement, ReadonlySet<number>>();

/** Direct writes identify calls that can benefit; read-only kernels keep their fast path. */
export function writtenArrayParameters(definition: FunctionStatement): ReadonlySet<number> {
    let result = writes.get(definition);
    if (!result) {
        const indices = new Set<number>();
        for (const node of AstUtils.streamAllContents(definition)) {
            if (!isArrayAssignmentStatement(node)
                || AstUtils.getContainerOfType(node, isFunctionStatement) !== definition) continue;
            const index = definition.parameters.indexOf(node.name);
            if (index >= 0) indices.add(index);
        }
        result = indices;
        writes.set(definition, result);
    }
    return result;
}
