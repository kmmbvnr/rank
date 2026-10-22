import { AstUtils, type AstNode } from 'langium';
import {
    isArrayAssignmentStatement, isAssignmentStatement, isExpression, isExpressionStatement, isForStatement, isFunctionBindingStatement, isFunctionParameter, isFunctionStatement,
    isNameExpression, isParenthesizedExpression, isReturnStatement, isStatement, isTryStatement, isUnpackStatement, isYieldStatement,
    type Expression, type FunctionStatement, type NameExpression, type Statement,
} from '../generated/ast.js';
import { scalarReadEffects } from './value-safety.js';
import type { ValueFacts } from './value-domain.js';

export interface LastArrayUseProof {
    readonly name: string;
    /** Unchanged caller-local bindings that must still hold bigints at transfer. */
    readonly integerSelectors: readonly string[];
}

const cache = new WeakMap<Expression, readonly (LastArrayUseProof | undefined)[]>();

/** Unguarded candidates only; guarded callers must use lastArrayUseProofs. */
export function lastArrayUseArguments(expression: Expression, arguments_: readonly Expression[]): readonly (string | undefined)[] {
    return lastArrayUseProofs(expression, arguments_).map(proof => proof?.integerSelectors.length ? undefined : proof?.name);
}

/** Last whole-value uses in a direct statement of a nonescaping function frame.
 * This proves only the caller's continuation; storage uniqueness and call identity
 * must still be checked at runtime.
 */
export function lastArrayUseProofs(expression: Expression, arguments_: readonly Expression[]): readonly (LastArrayUseProof | undefined)[] {
    const cached = cache.get(expression);
    if (cached) return cached;
    const result = analyze(expression, arguments_);
    cache.set(expression, result);
    return result;
}

function analyze(expression: Expression, arguments_: readonly Expression[]): readonly (LastArrayUseProof | undefined)[] {
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
        // without creating a Rank binding. The shared scalar-expression proof
        // rules out callbacks and retained array references under its guards.
        const integerSelectors = new Set<string>();
        for (const item of caller.statements.slice(0, index)) {
            for (const node of AstUtils.streamAllContents(item)) {
                if (!isNameExpression(node) || node.name !== name) continue;
                const selectors = scalarReadSelectors(node, caller, nodes);
                if (!selectors) return undefined;
                for (const selector of selectors) integerSelectors.add(selector);
            }
        }
        if (uses.filter(node => isNameExpression(node) && node.name === name).length !== 1) return undefined;
        if (later.some(node => 'name' in node && node.name === name)) return undefined;
        return { name, integerSelectors: [...integerSelectors] };
    });
}

/** The shared value/effect proof describes reads; this pass supplies lifetime guards. */
function scalarReadSelectors(node: NameExpression, caller: FunctionStatement, nodes: readonly AstNode[]): ReadonlySet<string> | undefined {
    let value: Expression = node;
    while (isExpression(value.$container)) value = value.$container;
    const statement = value.$container;
    if (!isStatement(statement)) return undefined;
    if (isAssignmentStatement(statement) && statement.name === node.name) return undefined;
    const selectors = new Set<string>();
    const proof = scalarReadEffects(value, name => {
        if (name === node.name) return {
            types: ['array'], rank: 1, shape: [null],
            elements: ['integer', 'real', 'boolean', 'text'], eagerScalarCells: true,
        } satisfies ValueFacts;
        if (statement.$container !== caller || !unchangedSelector(name, statement, caller, nodes)) return undefined;
        selectors.add(name);
        return { types: ['integer'], rank: 0, shape: [] };
    });
    return proof?.arrays.has(node.name) ? selectors : undefined;
}

/** Checking the same local at transfer is also a check of its earlier value.
 * Captures and block-local selectors need separate lifetime proofs.
 */
function unchangedSelector(name: string, read: Statement, caller: FunctionStatement, nodes: readonly AstNode[]): boolean {
    if (name.includes('.') || ['index', 'queue', 'set', 'counter'].includes(name)) return false;
    if (nodes.some(node => isUnpackStatement(node) && node.names.includes(name)
        || isForStatement(node) && node.condition
            && [node.condition, ...AstUtils.streamAllContents(node.condition)].some(part => isNameExpression(part) && part.name === name))) return false;
    const writes = nodes.filter(node => !isNameExpression(node) && !isFunctionParameter(node)
        && 'name' in node && node.name === name);
    if (caller.parameters.includes(name)) return writes.length === 0;
    const definition = writes[0];
    return writes.length === 1 && isAssignmentStatement(definition) && definition.$container === caller
        && caller.statements.indexOf(definition) < caller.statements.indexOf(read);
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
