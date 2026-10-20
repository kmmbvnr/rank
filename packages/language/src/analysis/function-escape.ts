import { AstUtils, type AstNode } from 'langium';
import {
    isApplicationExpression, isArrayAssignmentStatement, isArrayExpression, isAssignmentStatement, isBinaryExpression, isDeclaredCallExpression,
    isExpression, isExpressionStatement, isFunctionBindingStatement, isFunctionStatement, isKeyedSortExpression,
    isMaterializeExpression, isNameExpression, isParenthesizedExpression, isPushStatement,
    isRecordExpression, isReturnStatement, isTableFilterExpression, isTupleExpression, isYieldStatement,
    type Expression, type FunctionStatement,
} from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';
import { applicationForm } from '../application-forms.js';
import { functionCallSignature } from '../function-call-signature.js';
import { findOperation } from '../operations.js';
import { lexicalBinding, type FunctionScopeAnalysis, type LexicalBinding } from './function-scopes.js';

import { empty, union, escapeCalls, type Environment, type Flow } from './function-escape-calls.js';

// Materialization consumes the outer iterator, not lazy values inside its cells.
const materialized = (source: Flow): Flow => ({ ...source, lazy: new Set(source.stored) });

/** Follow callback values through local bindings and ordinary Rank helpers.
 * A helper is inspected with its actual callback arguments; it needs no annotation. */
export function functionEscapeDiagnostics(analysis: FunctionScopeAnalysis): { node: AstNode; message: string }[] {
    const diagnostics: { node: AstNode; message: string }[] = [];
    const nested = (fn: FunctionStatement): boolean => !!analysis.functions.get(fn)?.scope.parent?.parent;
    if (![...analysis.functions.keys()].some(nested)) return diagnostics;
    const report = (node: AstNode, fn: FunctionStatement, lazy: boolean): void => {
        const message = lazy ? `lazy result retains nested function ${fn.name}; materialize it before leaving its enclosing call.`
            : `nested function ${fn.name} cannot be returned, assigned, or stored; call it or pass it directly to a helper.`;
        if (!diagnostics.some(item => item.node === node && item.message === message)) diagnostics.push({ node, message });
    };
    const { values, bodies } = escapeInputs(analysis);
    const reading = new Set<LexicalBinding>();
    let budget = 20000;
    let exhausted = false;
    const value = (node: AstNode | undefined, env: Environment, asCallback = false): Flow => {
        if (!node) return empty();
        if (budget-- <= 0) { exhausted = true; return empty(); }
        const scope = analysis.scopes.get(node);
        if (isNameExpression(node)) {
            const binding = lexicalBinding(scope, node.name);
            if (!binding) return empty();
            if (binding.function) {
                if (!asCallback && functionCallSignature(binding.function).arity === 0) {
                    return invoke(binding.function, [], env, node);
                }
                return { ...empty(), functions: new Set([binding.function]) };
            }
            const supplied = env.get(binding);
            if (supplied) {
                if (asCallback) return supplied;
                return union([{ functions: new Set([...supplied.functions].filter(fn => functionCallSignature(fn).arity > 0)),
                    lazy: supplied.lazy, stored: supplied.stored }, ...[...supplied.functions].filter(fn => functionCallSignature(fn).arity === 0)
                    .map(fn => invoke(fn, [], env, node))]);
            }
            if (reading.has(binding)) return empty();
            reading.add(binding);
            try {
                const expressions = values.get(binding) ?? [];
                const result = expressions.length === 1 ? value(expressions[0], env)
                    : union(expressions.map(expression => value(expression, env)));
                env.set(binding, result);
                return result;
            }
            finally { reading.delete(binding); }
        }
        if (isParenthesizedExpression(node)) return value(node.value, env, asCallback);
        if (isBinaryExpression(node) && ['equal', 'notequal'].includes(node.operator)) {
            const operands = union([value(node.left, env), value(node.right, env)]);
            return { ...operands, functions: new Set() };
        }
        if (isMaterializeExpression(node)) return materialized(value(node.source, env));
        if (isTableFilterExpression(node)) {
            const source = value(node.source, env);
            const predicates = union((node.condition ? [node.condition] : node.conditions).map(condition => {
                const parts = flattenApplication(condition);
                const last = parts.at(-1)!;
                const callback = value(last, env, true);
                if (callback.functions.size) return union([callback, ...parts.slice(0, -1).map(part => value(part, env))]);
                return value(condition, env);
            }));
            return { ...source, lazy: new Set([...source.lazy, ...predicates.functions, ...predicates.lazy]) };
        }
        if (isKeyedSortExpression(node)) return materialized(value(node.source, env));
        if (isDeclaredCallExpression(node)) {
            const fn = value(node.callee, env, true);
            const args = node.arguments.map((argument, index) => value(argument, env,
                [...fn.functions].some(callee => functionCallSignature(callee).parameters[index]?.acceptsFunction)));
            if (!fn.functions.size) {
                for (const callback of union(args).functions) if (nested(callback)) report(node, callback, false);
            }
            const result = union([...fn.functions].map(callee => invoke(callee, args, env, node)));
            if (node.ranks.length || [...fn.functions].some(callee => callee.ranks.length)) {
                return { ...result, lazy: new Set([...fn.functions, ...union(args).lazy, ...result.stored]) };
            }
            return result;
        }
        if (isApplicationExpression(node)) {
            const form = applicationForm(node);
            if (form.kind === 'new-graph' && (form.predicate || form.successor)) {
                const callback = value((form.predicate ?? form.successor)!, env, true);
                return { ...empty(), lazy: new Set([...callback.functions, ...callback.lazy]) };
            }
            if (form.kind === 'named-reduce') {
                const source = value(form.source, env);
                const seed = form.seed ? value(form.seed, env) : source;
                const callbacks = value(form.operation, env, true);
                return union([seed, ...[...callbacks.functions].map(fn => invoke(fn, [seed, source], env, node))]);
            }
            if (form.kind === 'repeat') {
                const source = value(form.source, env);
                const callbacks = value(form.operation, env, true);
                const results = [...callbacks.functions].map(fn => invoke(fn, [source], env, node));
                if (form.until) {
                    const state = union([source, ...results]);
                    for (const fn of value(form.until, env, true).functions) invoke(fn, [state, state], env, node);
                }
                // Repeat invokes its callbacks eagerly; only their results can escape.
                return union([source, ...results]);
            }
            const parts = flattenApplication(node);
            const modifier = parts.findIndex(part => isNameExpression(part) && ['rank', 'outer', 'scan', 'segment'].includes(part.name));
            if (modifier >= 0) {
                const input = union(parts.slice(0, modifier).map(part => value(part, env)));
                return { ...input, functions: new Set(), lazy: new Set([...input.functions, ...input.lazy]) };
            }
            const last = parts.at(-1)!;
            const fn = value(last, env, true), args = parts.slice(0, -1).map(part => value(part, env));
            if (fn.functions.size) return union([...fn.functions].map(callee => invoke(callee, args, env, node)));
            const operation = isNameExpression(last) ? findOperation(last.name) : undefined;
            if (operation && ['integer', 'real', 'number', 'boolean', 'text', 'bytes', 'date', 'datetime', 'duration'].includes(operation.result)) return empty();
            // Local graph traversals eagerly consume the relation and return only
            // scalar vertex/weight data, never the graph's retained callback.
            if (operation?.module === 'graph' && ['bfs', 'dfs', 'dijkstra'].includes(operation.name)
                && isNameExpression(last) && !lexicalBinding(scope, last.name)) return empty();
            if (operation?.name === 'array' || operation?.name === 'copy') return materialized(union(args));
            const result = union(args);
            // Opaque helpers cannot promise not to retain a nested callback.
            if (isNameExpression(last) && (!operation || lexicalBinding(scope, last.name))) {
                for (const callback of result.functions) if (nested(callback)) report(node, callback, false);
            }
            return result;
        }
        const result = union([...AstUtils.streamContents(node)].map(child => value(child, env)));
        if (isArrayExpression(node) || isRecordExpression(node) || isTupleExpression(node)) {
            for (const fn of result.lazy) result.stored.add(fn);
        }
        return result;
    };
    const check = (node: AstNode, env: Environment, owner?: FunctionStatement): Flow | undefined => {
        let result: Flow | undefined;
        if (isExpressionStatement(node)) value(node.value, env);
        if (isReturnStatement(node) || isYieldStatement(node)) {
            result = value(node.value, env);
            for (const fn of result.lazy) {
                if (nested(fn) && analysis.functions.get(fn)?.scope.parent?.owner === owner) report(node, fn, true);
            }
        } else if (isAssignmentStatement(node) || isFunctionBindingStatement(node)
            || isArrayAssignmentStatement(node) || isPushStatement(node)) result = value(node.value, env);
        if (result && (isArrayAssignmentStatement(node) || isPushStatement(node))) {
            const scope = analysis.scopes.get(node);
            const receiver = isPushStatement(node) ? flattenApplication(node.receiver)[0] : undefined;
            const name = isArrayAssignmentStatement(node) ? node.name : isNameExpression(receiver) ? receiver.name : undefined;
            const binding = name ? lexicalBinding(scope, name) : undefined;
            if (binding) {
                const target = env.get(binding) ?? union((values.get(binding) ?? []).map(expression => value(expression, env)));
                for (const fn of result.functions) target.functions.add(fn);
                for (const fn of result.lazy) { target.lazy.add(fn); target.stored.add(fn); }
                env.set(binding, target);
            }
        }
        if (result) for (const fn of result.functions) if (nested(fn)) report(node, fn, false);
        return result;
    };
    const evaluate = (fn: FunctionStatement, args: readonly Flow[], outer: Environment): Flow => {
        const info = analysis.functions.get(fn)!;
        const env = new Map(outer);
        for (const binding of env.keys()) if (binding.scope.owner === fn) env.delete(binding);
        for (const [index, parameter] of functionCallSignature(fn).parameters.entries()) {
            const binding = lexicalBinding(info.scope, parameter.name)!;
            env.set(binding, args[index] ?? empty());
        }

        const nodes = bodies.get(fn) ?? [];
        const returns: Flow[] = [];
        const yields: Flow[] = [];
        for (const node of nodes) {
            const result = check(node, env, fn);
            if (result && isReturnStatement(node)) returns.push(result);
            if (result && isYieldStatement(node)) yields.push(result);
        }
        if (yields.length) {
            const emitted = union(yields);
            return { functions: emitted.functions, lazy: new Set([fn, ...emitted.lazy]), stored: new Set(emitted.lazy) };
        }
        return union(returns);
    };
    const calls = escapeCalls(evaluate);
    const invoke = (fn: FunctionStatement, args: readonly Flow[], outer: Environment, site: AstNode): Flow => {
        if (analysis.functions.has(fn)) return calls(fn, args, outer);
        const result = union(args);
        for (const callback of result.functions) if (nested(callback)) report(site, callback, false);
        return result;
    };
    for (const fn of analysis.functions.keys()) {
        budget = 20000;
        exhausted = false;
        invoke(fn, [], new Map(), fn);
        if (exhausted) diagnostics.push({ node: fn, message: `cannot prove callback lifetimes in ${fn.name} within the analysis limit.` });
    }
    const topEnvironment: Environment = new Map();
    for (const [node, scope] of analysis.scopes) {
        if (isFunctionStatement(scope.owner)) continue;
        budget = 20000;
        check(node, topEnvironment);
        if (isExpression(node)) value(node, topEnvironment);
    }
    return diagnostics;
}

/** Index lexical inputs once; expression evaluation uses these binding identities. */
function escapeInputs(analysis: FunctionScopeAnalysis) {
    const values = new Map<LexicalBinding, Expression[]>();
    const bodies = new Map<FunctionStatement, AstNode[]>();
    for (const [node, scope] of analysis.scopes) {
        if (isFunctionStatement(scope.owner)) {
            const nodes = bodies.get(scope.owner) ?? [];
            nodes.push(node);
            bodies.set(scope.owner, nodes);
        }
        if (isAssignmentStatement(node) || isFunctionBindingStatement(node)) {
            const binding = lexicalBinding(scope, node.name);
            if (binding) {
                const expressions = values.get(binding) ?? [];
                expressions.push(node.value);
                values.set(binding, expressions);
            }
        }
    }
    return { values, bodies };
}
