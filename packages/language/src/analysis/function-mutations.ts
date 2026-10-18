import type { AstNode } from 'langium';
import {
    isApplicationExpression, isArrayAssignmentStatement, isAssignmentStatement, isDeclaredCallExpression,
    isFunctionBindingStatement, isFunctionStatement, isNameExpression, isOperationAssignmentStatement, isParenthesizedExpression,
    isPushStatement, type Expression, type FunctionStatement,
} from '../generated/ast.js';
import { applicationForm } from '../application-forms.js';
import { flattenApplication } from '../expressions.js';
import { functionCallSignature } from '../function-call-signature.js';
import { findOperation, type Operation } from '../operations.js';
import { lexicalBinding, type FunctionScopeAnalysis, type LexicalBinding, type LexicalScope } from './function-scopes.js';

/** Mutation provenance, including aliases and calls through ordinary helpers.
 * Bindings are identities from the lexical pass; no spelling-based capture guesses. */
export function functionMutationDiagnostics(analysis: FunctionScopeAnalysis): { node: AstNode; message: string }[] {
    type Callable = FunctionStatement | Operation;
    const builtinAliases = new Map<LexicalBinding, Operation>();
    const aliases = new Map<LexicalBinding, Set<LexicalBinding>>();
    const writes = new Map<FunctionStatement, Map<LexicalBinding, AstNode>>();
    const calls: { node: AstNode; owner?: FunctionStatement; callee: LexicalBinding;
        arguments: readonly Expression[]; scope: LexicalScope }[] = [];
    const receiver = (expression: Expression, scope: LexicalScope): LexicalBinding | undefined => {
        while (isParenthesizedExpression(expression)) expression = expression.value;
        if (isNameExpression(expression)) return lexicalBinding(scope, expression.name);
        // An indexed/field receiver still reaches the original container.
        if (isApplicationExpression(expression)) {
            const parts = flattenApplication(expression);
            if (parts.slice(1).some(part => isNameExpression(part) && findOperation(part.name))) return undefined;
            return receiver(parts[0], scope);
        }
        return undefined;
    };
    const add = (owner: FunctionStatement, binding: LexicalBinding | undefined, node: AstNode): boolean => {
        if (!binding) return false;
        let own = writes.get(owner);
        if (!own) writes.set(owner, own = new Map());
        if (own.has(binding)) return false;
        own.set(binding, node);
        return true;
    };
    const targets = (binding: LexicalBinding | undefined, callbacks: ReadonlyMap<LexicalBinding, ReadonlySet<Callable>>, seen = new Set<LexicalBinding>()): Set<Callable> => {
        if (!binding || seen.has(binding)) return new Set();
        seen.add(binding);
        return new Set<Callable>([...(binding.function ? [binding.function] : []),
            ...(builtinAliases.has(binding) ? [builtinAliases.get(binding)!] : []), ...callbacks.get(binding) ?? [],
            ...[...aliases.get(binding) ?? []].flatMap(alias => [...targets(alias, callbacks, seen)])]);
    };
    const argumentTargets = (expression: Expression, scope: LexicalScope,
        callbacks: ReadonlyMap<LexicalBinding, ReadonlySet<Callable>>): Set<Callable> => {
        while (isParenthesizedExpression(expression)) expression = expression.value;
        const binding = receiver(expression, scope);
        if (binding) return targets(binding, callbacks);
        const operation = isNameExpression(expression) ? findOperation(expression.name) : undefined;
        return new Set(operation ? [operation] : []);
    };
    for (const [node, scope] of analysis.scopes) {
        const owner = isFunctionStatement(scope.owner) ? scope.owner : undefined;
        if (isAssignmentStatement(node) && node.operator === '=' || isFunctionBindingStatement(node)) {
            const target = lexicalBinding(scope, node.name), source = receiver(node.value, scope);
            if (target && !source && isNameExpression(node.value)) {
                const operation = findOperation(node.value.name);
                if (operation) builtinAliases.set(target, operation);
            }
            if (target && source && target !== source) {
                let sources = aliases.get(target);
                if (!sources) aliases.set(target, sources = new Set());
                sources.add(source);
            }
        }
        if (owner && (isArrayAssignmentStatement(node) || isOperationAssignmentStatement(node))) {
            add(owner, lexicalBinding(scope, node.name), node);
        } else if (owner && isPushStatement(node)) {
            add(owner, receiver(node.receiver, scope), node);
        } else if (isDeclaredCallExpression(node)) {
            const callee = isNameExpression(node.callee) && lexicalBinding(scope, node.callee.name);
            if (callee) calls.push({ node, owner, callee, arguments: node.arguments, scope });
        } else if (isApplicationExpression(node)) {
            const parts = flattenApplication(node);
            const last = parts.at(-1);
            const binding = last && isNameExpression(last) ? lexicalBinding(scope, last.name) : undefined;
            if (binding) {
                calls.push({ node, owner, callee: binding, arguments: parts.slice(0, -1), scope });
            }
            const form = applicationForm(node);
            if (owner && (form?.kind === 'collection-mutation' || form?.kind === 'dsu-method' && form.operation === 'merge')) {
                add(owner, receiver(form.receiver, scope), node);
            } else if (owner && !binding && last && isNameExpression(last)
                && findOperation(last.name)?.effects?.includes('mutates')) {
                add(owner, receiver(parts[0], scope), node);
            }
        }
    }
    // Summaries are specific to the callbacks supplied at a call site. Joining
    // every callback ever passed to a helper would reject read-only calls merely
    // because another caller uses that helper with a mutating operation.
    type CallbackEnvironment = ReadonlyMap<LexicalBinding, ReadonlySet<Callable>>;
    type Context = { owner: FunctionStatement; callbacks: CallbackEnvironment; writes: Map<LexicalBinding, AstNode> };
    const ids = new Map<object, number>();
    const id = (value: object): number => {
        if (!ids.has(value)) ids.set(value, ids.size);
        return ids.get(value)!;
    };
    const contexts = new Map<string, Context>();
    const context = (owner: FunctionStatement, callbacks: CallbackEnvironment): Context => {
        const key = `${id(owner)}:${[...callbacks].map(([binding, functions]) =>
            `${id(binding)}=${[...functions].map(id).sort((a, b) => a - b).join(',')}`).sort().join(';')}`;
        let result = contexts.get(key);
        if (!result) {
            result = { owner, callbacks, writes: new Map(writes.get(owner)) };
            contexts.set(key, result);
        }
        return result;
    };
    const callsByOwner = new Map<FunctionStatement | undefined, typeof calls>();
    for (const call of calls) {
        const own = callsByOwner.get(call.owner) ?? [];
        own.push(call);
        callsByOwner.set(call.owner, own);
    }
    for (const owner of analysis.functions.keys()) context(owner, new Map());
    const diagnostics: { node: AstNode; message: string }[] = [];
    let changed = true;
    const addWrite = (own: Context, binding: LexicalBinding | undefined, node: AstNode): void => {
        if (!binding || binding.kind === 'function' || own.writes.has(binding)) return;
        own.writes.set(binding, node);
        changed = true;
    };
    const visit = (call: typeof calls[number], caller?: Context): void => {
        const environment = caller?.callbacks ?? new Map();
        const callees = targets(call.callee, environment);
        const opaque = isDeclaredCallExpression(call.node)
            || call.callee.kind === 'parameter' && isFunctionStatement(call.callee.scope.owner)
                && functionCallSignature(call.callee.scope.owner).parameters.some(parameter =>
                    parameter.name === call.callee.name && parameter.acceptsFunction)
            || isFunctionBindingStatement(call.callee.declaration)
            || call.callee.scope.owner.$type === 'Program' && isNameExpression(call.callee.declaration)
                && /^[a-z]/.test(call.callee.name);
        // Unknown callbacks may mutate any argument. Keep this conservative
        // effect in their parameter summary and substitute at the call site.
        if (caller && !callees.size && opaque) {
            for (const argument of call.arguments) addWrite(caller, receiver(argument, call.scope), call.node);
        }
        for (const callee of callees) {
            if (!isFunctionStatement(callee)) {
                if (caller && callee.effects?.includes('mutates') && call.arguments[0]) {
                    addWrite(caller, receiver(call.arguments[0], call.scope), call.node);
                }
                continue;
            }
            const parameters = functionCallSignature(callee).parameters;
            if (parameters.length !== call.arguments.length) continue;
            const supplied = new Map(environment);
            for (const [index, parameter] of parameters.entries()) {
                if (!parameter.acceptsFunction) continue;
                const binding = lexicalBinding(analysis.functions.get(callee)?.scope, parameter.name);
                if (binding) supplied.set(binding, argumentTargets(call.arguments[index], call.scope, environment));
            }
            const called = context(callee, supplied);
            if (!caller) continue;
            for (const [binding] of called.writes) {
                if (binding.scope.owner !== callee) addWrite(caller, binding, call.node);
                else if (binding.kind === 'parameter') {
                    const index = parameters.findIndex(parameter => parameter.name === binding.name);
                    const argument = call.arguments[index];
                    if (argument) addWrite(caller, receiver(argument, call.scope), call.node);
                }
            }
        }
    };
    while (changed) {
        changed = false;
        const before = contexts.size;
        for (const call of callsByOwner.get(undefined) ?? []) visit(call);
        for (const own of contexts.values()) {
            for (const [binding, node] of own.writes) {
                for (const alias of aliases.get(binding) ?? []) addWrite(own, alias, node);
            }
            for (const call of callsByOwner.get(own.owner) ?? []) visit(call, own);
        }
        changed ||= contexts.size !== before;
    }
    for (const { owner, writes: own } of contexts.values()) for (const [binding, node] of own) {
        if (binding.scope.owner !== owner) diagnostics.push({ node,
            message: `${binding.name} is read-only in ${owner.name}; pass mutable state explicitly as a parameter.` });
        else if (owner.memo && binding.kind === 'parameter') diagnostics.push({ node,
            message: `memo ${owner.name} cannot mutate parameter ${binding.name}; use a local copy.` });
    }
    return diagnostics.filter((item, index) => !diagnostics.slice(0, index)
        .some(previous => previous.node === item.node && previous.message === item.message));
}
