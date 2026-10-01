import { AstUtils, type AstNode } from 'langium';
import {
    isApplicationExpression, isAllAxisExpression, isNameExpression, isNumberLiteral, isStringLiteral, isParenthesizedExpression,
    isArrayExpression, isMaterializeExpression, isUnaryExpression, isBooleanLiteral, isLabelLiteral,
    isArrayAssignmentStatement, isAssignmentStatement, isIndexAssignmentStatement, isBinaryExpression,
    isExpressionStatement, isNewStructureExpression, isRecordExpression, isRecordUpdateExpression,
    isForStatement, isFunctionStatement, isIfStatement, isReturnStatement, isStdinExpression,
    isAddStatement, isArgumentStatement, isPushStatement, isTryStatement, isUnpackStatement, isUseStatement,
    isBoundClauseExpression, isCountClauseExpression, isFirstIndexWhereExpression, isFirstWhereExpression,
    isTakeWhileExpression,
    type Expression, type Program, type Statement, type FunctionStatement,
    type TryStatement,
} from '../generated/ast.js';
import { compoundType } from './types.js';
import { flattenApplication } from '../expressions.js';
import { findOperation, type Operation } from '../operations.js';
import { builtinBindingDiagnostics } from '../builtin-bindings.js';
import { renamedBuiltinCall } from '../builtin-renames.js';
import { arrayRank, conditionalPaths, contractRank, invalidate, mergeEnvironments } from './control-flow.js';
import { bindingRankConflict, bindingRankMessage, bindingTypeMessage,
    provenBindingTypeConflict } from '../binding-rule.js';
import { functionEffects, isPlainArrayWrite } from './function-effects.js';
import { functionYields, generatorCells, yieldTypes } from './function-yields.js';
import { createCallAnalysis } from './function-calls.js';
import { createReturnPathAnalysis } from './return-paths.js';
import { recordFieldConflict } from './return-contract.js';
import { createLoopAnalysis } from './loop-analysis.js';
import { directValue, safeCollectionValue, safeIndexDefault, safeRead, scalarArithmetic, scalarBitwise } from './value-safety.js';
import { expressionFacts } from './value-facts.js';
import { hasCallbackFreeFindProof } from './operation-proofs.js';
import { incompatibleShapes, isAtom, joinValueFacts, stableRecordField, UNKNOWN_VALUE, UnobservedReturn,
    type ValueFacts, type FactLookup } from './value-domain.js';

export interface ValueDiagnostic {
    readonly node: AstNode;
    readonly message: string;
    readonly kind: 'TypeError' | 'DimensionMismatch';
    readonly code?: 'BuiltinRename' | 'RaggedLift';
    readonly severity?: 'warning';
}

export interface ValueAnalysis {
    readonly diagnostics: readonly ValueDiagnostic[];
    readonly bindings: ReadonlyMap<string, ValueFacts>;
    readonly expressions: ReadonlyMap<Expression, ValueFacts>;
    readonly functions: ReadonlyMap<string, FunctionStatement>;
    readonly functionResults: readonly ValueFacts[];
}

let nextCollectionId = 0;

/** A non-executing pass. Unknown facts never justify a diagnostic. */
export function analyzeValues(program: Program, initial: ReadonlyMap<string, ValueFacts> = new Map(),
    declarations: ReadonlyMap<string, FunctionStatement> = new Map(),
    examples: readonly { name: string; arguments: readonly ValueFacts[] }[] = [],
    loadModule?: (path: string) => Program | undefined): ValueAnalysis {
    const diagnostics: ValueDiagnostic[] = builtinBindingDiagnostics(program, undefined, declarations.values(), loadModule);
    const expressions = new Map<Expression, ValueFacts>();
    const bindings = new Map(initial);
    const numeric = new Set(['integer', 'real']);
    const functions = new Map(declarations);
    const calls = createCallAnalysis(bindings, functions, diagnostics, expressions,
        (items, env) => paths.returnPaths(items, env).values,
        (module, name, arguments_) => {
            const analysis = analyzeValues(module, new Map(), new Map(), [{ name, arguments: arguments_ }]);
            return { result: analysis.functionResults[0], diagnostics: analysis.diagnostics };
        });
    const { functionBindings, imported, importedAliases, globalCallEnvs, privateBindings } = calls;
    function invalidateImportedAlias(alias: string, env: Map<string, ValueFacts>): void {
        for (const name of imported.keys()) if (name.startsWith(`${alias}.`)) {
            env.set(name, invalidate(env.get(name)));
        }
    }

    const paths = createReturnPathAnalysis({
        diagnostics,
        directCallBeforeEffects: (expression, env) => directCallBeforeEffects(expression, env),
        directNoReturnCall: (expression, env) => calls.directNoReturnCall(expression, env),
        invalidateCalls: (expression, env) => invalidateCalls(expression, env),
        inspect: (expression, env) => inspect(expression, env),
        tryPrefixFacts: (statement, env) => tryPrefixFacts(statement, env),
        forgetNonFunctions: env => forgetNonFunctions(env),
        loop: (statement, env) => loops.loop(statement, env),
        loopReturnPaths: (statement, env) => loops.loopReturnPaths(statement, env),
        statements: (items, env) => statements(items, env),
    });
    function insertCollectionElement(name: string, value: ValueFacts, node: Expression,
        env: Map<string, ValueFacts>): void {
        const collection = env.get(name);
        if (!collection || !['set', 'counter', 'queue', 'stack', 'deque', 'heap'].includes(collection.types.join())
            || !value.types.length) return;
        const accepted = collection.elements;
        if (accepted?.length && value.types.every(type => !accepted.includes(type))) {
            diagnostics.push({ node, kind: 'TypeError',
                message: `${name} holds ${accepted.join(' or ')} and cannot receive ${value.types.join(' or ')}` });
            return;
        }
        const rank = value.types.join() === 'array' ? value.rank : undefined;
        if (accepted?.join() === 'array' && collection.elementRank !== undefined
            && rank !== undefined && collection.elementRank !== rank) {
            diagnostics.push({ node, kind: 'DimensionMismatch',
                message: `${name} holds array rank ${collection.elementRank} and cannot receive rank ${rank}` });
            return;
        }
        const nonempty = value.shape?.every(size => size !== null && size > 0) === true;
        if (nonempty && accepted?.join() === 'array' && collection.elementCells?.length && value.elements?.length
            && value.elements.every(type => !collection.elementCells!.includes(type))) {
            diagnostics.push({ node, kind: 'TypeError',
                message: `${name} holds array of ${collection.elementCells.join(' or ')} and cannot receive array of ${value.elements.join(' or ')}` });
            return;
        }
        // Unknown host collections need runtime validation before we can publish facts.
        if (collection.collectionId === undefined) return;
        for (const [alias, fact] of env) if (fact.collectionId === collection.collectionId) {
            env.set(alias, { ...fact, elements: accepted?.length ? accepted : value.types,
                ...(rank !== undefined ? { elementRank: collection.elementRank ?? rank } : {}),
                ...(!accepted?.length && nonempty && value.types.join() === 'array' && value.elements?.length
                    ? { elementCells: value.elements } : {}) });
        }
    }
    function tryPrefixFacts(statement: TryStatement,
        env: Map<string, ValueFacts>): Map<string, ValueFacts> | undefined {
        const indexNames = [...env].filter(([, fact]) => fact.types.join() === 'index' && fact.elements !== undefined)
            .map(([name]) => name);
        const start = diagnostics.length;
        const beforeExpressions = new Map(expressions);
        const prefix = new Map(env);
        const paths = [new Map(prefix)];
        try {
            for (const item of statement.statements) {
                if (isAssignmentStatement(item)) {
                    if (indexNames.includes(item.name)) return;
                } else if (isIndexAssignmentStatement(item)) {
                    if (!item.keys.every(key => directValue(key) && isAtom(expressionFacts(key, name => prefix.get(name))))
                        || !(directValue(item.value) || scalarArithmetic(item.value, prefix)
                            || scalarBitwise(item.value, prefix))) return;
                } else if (isReturnStatement(item)) {
                    const value = item.value;
                    if (!value || directValue(value) || scalarArithmetic(value, prefix)
                        || scalarBitwise(value, prefix)) break;
                    const parts = isApplicationExpression(value) ? flattenApplication(value) : [];
                    const input = parts[0] && expressionFacts(parts[0], name => prefix.get(name));
                    if (parts.length === 2 && isNameExpression(parts[1]) && parts[1].name === 'integer'
                        && !prefix.has('integer') && directValue(parts[0]) && input?.types.length
                        && input.types.every(type => ['integer', 'real', 'text'].includes(type))) break;
                    return;
                } else return;
                if (!statements([item], prefix) || indexNames.some(name => prefix.get(name)?.types.join() !== 'index'
                    || prefix.get(name)?.elements === undefined)) return;
                paths.push(new Map(prefix));
            }
            const privateNames = privateBindings.at(-1);
            return new Map([...env.keys()].flatMap(name => {
                if (!privateNames?.has(name) && !(privateNames && name === 'index')) return [];
                const fact = joinValueFacts(paths.map(path => path.get(name) ?? UNKNOWN_VALUE));
                return fact.types.length ? [[name, fact] as const] : [];
            }));
        } finally {
            diagnostics.length = start;
            expressions.clear();
            for (const [node, fact] of beforeExpressions) expressions.set(node, fact);
        }
    }
    const forgetNonFunctions = (env: Map<string, ValueFacts>): void => {
        const protectedNames = privateBindings.at(-1);
        for (const [name, fact] of env) if (!fact.types.includes('function')) {
            const accepted = fact.acceptedTypes ?? fact.types;
            const privateValue = protectedNames?.has(name) && accepted.length > 0;
            const rank = contractRank(fact);
            // Unknown calls may mutate a private value, but cannot rebind its uncaptured local name.
            env.set(name, privateValue && fact.types.length > 0
                && fact.types.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))
                && accepted.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))
                ? { types: accepted, acceptedTypes: accepted, rank: 0, shape: [] }
                : privateValue && fact.types.join() === 'text' && accepted.join() === 'text'
                    ? { types: ['text'], acceptedTypes: ['text'], rank: 1, shape: [null] }
                    : privateValue && fact.types.join() === 'array' && accepted.join() === 'array'
                        ? { types: ['array'], acceptedTypes: ['array'], acceptedArrayRank: rank,
                            ...(rank !== undefined ? { rank, shape: Array(rank).fill(null) } : {}) }
                        : privateValue && fact.types.length === 1 && accepted.join() === fact.types.join()
                            ? { types: fact.types, acceptedTypes: accepted }
                            : invalidate(fact));
        }
    };
    const loops = createLoopAnalysis({
        diagnostics, expressions, functions, functionBindings,
        globalEnv: () => globalCallEnvs.at(-1),
        inspect: (expression, env) => inspect(expression, env),
        invalidateCalls: (expression, env) => invalidateCalls(expression, env),
        statements: (items, env) => statements(items, env),
        returnPaths: (items, env) => paths.returnPaths(items, env),
        forgetNonFunctions,
    });
    function invalidateCalls(expression: AstNode, env: Map<string, ValueFacts>): void {
        const syntax = new Set(['reduce', 'scan', 'outer', 'rank', 'axis', 'with', 'segment', 'from']);
        const effects = functionEffects(name => env.get(name) === functionBindings.get(name) ? functions.get(name) : undefined,
            name => env.get(name)?.types.includes('function') ?? false,
            name => env.has(name), name => env.get(name));
        const nodes = [expression, ...AstUtils.streamAllContents(expression)];
        let unknown = false;
        const written = new Set<string>();
        const writtenGlobals = new Set<string>();
        const numericWritten = new Set<string>();
        const numericWrittenGlobals = new Set<string>();
        const unprovenWritten = new Set<string>();
        const unprovenWrittenGlobals = new Set<string>();
        const rebound = new Set<string>();
        for (const node of nodes) {
            if (isStdinExpression(node)) unknown = true;
            if (isRecordExpression(node) || isRecordUpdateExpression(node)) {
                for (const field of node.fields) {
                    const value = expressionFacts(field.value, name => env.get(name));
                    if (value.types.includes('array') && !safeRead(value)) unknown = true;
                }
            }
            if (!isNameExpression(node)) continue;
            if (env.get(node.name)?.types.includes('function')) {
                // Only the restricted numeric proof can provisionally preserve
                // effects. A general recursive return contract proves no purity.
                if (calls.hasPureRecursiveProbe(node.name)) continue;
                let site: AstNode = node;
                while (isApplicationExpression(site.$container)) site = site.$container;
                const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                const external = imported.get(node.name);
                const arity = functions.get(node.name)?.parameters.length
                    ?? external?.functions.get(external.name)?.parameters.length;
                const arguments_ = parts.at(-1) === node && parts.length - 1 === arity
                    ? parts.slice(0, -1)
                    : isApplicationExpression(site) && isApplicationExpression(site.head)
                        && site.arguments.length === 1 && site.arguments[0] === node
                        && site.head.arguments.length + 1 === arity
                        ? [site.head.head, ...site.head.arguments] : undefined;
                const inputs = arguments_?.map(part => expressionFacts(part, name => env.get(name)));
                const result = external && env.get(node.name) === external.binding
                    ? functionEffects(name => external.functions.get(name), name => external.functions.has(name),
                        name => external.functions.has(name))(external.name, inputs)
                    : effects(node.name, inputs);
                // Host input may re-enter Rank. It is identified separately in
                // the summary, but cannot preserve pre-call value facts here.
                unknown ||= result.unknown || result.io;
                // Other indexed structures can invoke user callbacks on writes.
                const array = (fact: ValueFacts | undefined) => !!fact?.types.length
                    && fact.types.every(type => type === 'array');
                for (const capture of result.captures) {
                    const global = result.globalWriteCaptures.has(capture);
                    const source = global ? globalCallEnvs.at(-1) ?? env : env;
                    unknown ||= !array(source.get(capture));
                    (global ? writtenGlobals : written).add(capture);
                    const preserved = global ? numericWrittenGlobals : numericWritten;
                    const unproven = global ? unprovenWrittenGlobals : unprovenWritten;
                    if (result.numericCaptureWrites?.has(capture) && safeRead(source.get(capture))) {
                        if (!unproven.has(capture)) preserved.add(capture);
                    } else {
                        unproven.add(capture);
                        preserved.delete(capture);
                    }
                }
                for (const capture of result.bindingCaptures) rebound.add(capture);
                for (const capture of result.readCaptures) {
                    const source = result.globalReadCaptures.has(capture)
                        ? globalCallEnvs.at(-1) ?? env : env;
                    unknown ||= !safeRead(source.get(capture));
                }
                if (result.parameters.size || result.readParameters.size) {
                    if (!arguments_) unknown = true;
                    else {
                        for (const index of result.parameters) {
                            unknown ||= !array(expressionFacts(arguments_[index], name => env.get(name)));
                        }
                        for (const index of result.readParameters) {
                            unknown ||= !safeRead(expressionFacts(arguments_[index], name => env.get(name)));
                        }
                    }
                }
            } else if (/^[a-z]/.test(node.name) && !env.has(node.name) && !syntax.has(node.name)) {
                if (node.name === 'index') {
                    let site: AstNode = node;
                    while (isApplicationExpression(site.$container)
                        || isParenthesizedExpression(site.$container)) site = site.$container;
                    const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                    if (!parts.length || parts[0] === node && parts.slice(1).every(directValue)) continue;
                }
                if (['queue', 'set', 'counter'].includes(node.name)) {
                    let site: AstNode = node;
                    while (isParenthesizedExpression(site.$container)) site = site.$container;
                    if (!isApplicationExpression(site.$container)) continue;
                    if (node.name === 'counter') {
                        const parts = flattenApplication(site.$container);
                        const key = parts[1] && expressionFacts(parts[1], name => env.get(name));
                        if (parts.length === 2 && parts[0] === node && directValue(parts[1])
                            && key && isAtom(key) && key.types.length > 0
                            && key.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol',
                                'date', 'datetime'].includes(type))) continue;
                    }
                    if (node.name === 'queue') {
                        while (isApplicationExpression(site.$container)) site = site.$container;
                        const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                        if (parts.length === 2 && parts[1] === node) {
                            const source = expressionFacts(parts[0], name => env.get(name));
                            if (safeRead(source) || source.types.join() === 'queue') continue;
                        }
                    }
                }
                if (node.name === 'raise') {
                    let site: AstNode = node;
                    while (isApplicationExpression(site.$container)) site = site.$container;
                    const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                    if ((parts.length === 2 || parts.length === 3) && parts.at(-1) === node
                        && isLabelLiteral(parts[0]) && (parts.length === 2 || directValue(parts[1])
                            && isAtom(expressionFacts(parts[1], name => env.get(name))))) continue;
                }
                if (node.name === 'add') {
                    let site: AstNode = node;
                    while (isApplicationExpression(site.$container)) site = site.$container;
                    const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                    const graph = parts[0] && isNameExpression(parts[0]) ? env.get(parts[0].name) : undefined;
                    const scalar = (part: Expression, allowed: readonly string[]) => {
                        const fact = expressionFacts(part, name => env.get(name));
                        return directValue(part) && isAtom(fact) && fact.types.length > 0
                            && fact.types.every(type => allowed.includes(type));
                    };
                    if (parts[1] === node && (parts.length === 4 || parts.length === 5)
                        && graph?.types.join() === 'graph' && graph.elements?.length
                        && parts.slice(2, 4).every(part => scalar(part,
                            ['integer', 'real', 'boolean', 'text', 'symbol']))
                        && (parts.length === 4 || scalar(parts[4], ['integer', 'real']))) continue;
                }
                if (node.name === 'merge') {
                    let site: AstNode = node;
                    while (isApplicationExpression(site.$container)) site = site.$container;
                    const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                    const dsu = parts[0] && isNameExpression(parts[0]) ? env.get(parts[0].name) : undefined;
                    if (parts.length === 4 && parts[1] === node && dsu?.types.join() === 'dsu'
                        && parts.slice(2).every(part => {
                            const fact = expressionFacts(part, name => env.get(name));
                            return directValue(part) && isAtom(fact) && fact.types.length > 0
                                && fact.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol'].includes(type));
                        })) continue;
                }
                if (node.name === 'len') {
                    let site: AstNode = node;
                    while (isApplicationExpression(site.$container)) site = site.$container;
                    const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                    const source = parts[0] && expressionFacts(parts[0], name => env.get(name));
                    if (parts.includes(node) && source?.types.join() === 'sequence'
                        && source.callbackFreeScalarCells !== true) {
                        unknown = true;
                        continue;
                    }
                }
                if (node.name === 'indices') {
                    let site: AstNode = node;
                    while (isApplicationExpression(site.$container)) site = site.$container;
                    const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                    const source = parts[0] && expressionFacts(parts[0], name => env.get(name));
                    if (parts.length === 2 && parts[1] === node
                        && source?.eagerScalarCells !== true && source?.callbackFreeScalarCells !== true) {
                        unknown = true;
                        continue;
                    }
                }
                if (node.name === 'find' || node.name === 'findall') {
                    let site: AstNode = node;
                    while (isApplicationExpression(site.$container)) site = site.$container;
                    const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                    if (parts.length === 3 && parts[2] === node) {
                        const source = expressionFacts(parts[0], name => env.get(name));
                        const renamed = renamedBuiltinCall(parts);
                        // Removed builtin calls fail before invoking a callback; keep
                        // the receiver facts so inspection can report the migration.
                        if (renamed && source.types.join() === renamed.receiver) continue;
                        const target = expressionFacts(parts[1], name => env.get(name));
                        if (!hasCallbackFreeFindProof(source, target)) {
                            unknown = true;
                            continue;
                        }
                    }
                }
                if (['pop', 'popfront', 'popback'].includes(node.name)) {
                    let site: AstNode = node;
                    while (isApplicationExpression(site.$container)) site = site.$container;
                    const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                    const receiver = parts[0] && isNameExpression(parts[0]) ? env.get(parts[0].name) : undefined;
                    const kinds = node.name === 'pop' ? ['queue', 'stack', 'deque', 'heap'] : ['deque'];
                    if (parts.length === 2 && parts[1] === node && receiver?.types.length
                        && receiver.types.every(type => kinds.includes(type))) continue;
                }
                const operation = findOperation(node.name);
                if (!operation || operation.effects?.length) unknown = true;
            }
        }
        if (!unknown && !written.size && !writtenGlobals.size && !rebound.size) return;
        // An unknown call can change captured bindings. Do not use a pre-call
        // shape, even in another operand of the same expression.
        if (unknown) {
            forgetNonFunctions(env);
            const global = globalCallEnvs.at(-1);
            if (global && global !== env) for (const [name, fact] of global) {
                if (!fact.types.includes('function')) global.set(name, invalidate(fact));
            }
            return;
        }
        // Parameter arrays have value semantics. A write to one parameter
        // cannot alter its caller's array, even if two arguments share storage.
        for (const [source, names, preserved] of [[env, written, numericWritten],
            [globalCallEnvs.at(-1) ?? env, writtenGlobals, numericWrittenGlobals]] as const) {
            for (const name of names) {
                const fact = source.get(name);
                if (fact) source.set(name, { ...fact,
                    ...(!preserved.has(name) ? { elements: undefined, eagerScalarCells: undefined,
                        callbackFreeScalarCells: undefined } : {}),
                    integers: undefined, positions: undefined, positionFacts: undefined });
            }
        }
        for (const name of rebound) {
            const fact = env.get(name);
            if (fact) env.set(name, invalidate(fact));
        }
    }

    function inspect(expression: Expression, env: Map<string, ValueFacts>): ValueFacts {
        const lookup: FactLookup = Object.assign((name: string) => env.get(name), {
            invoke: (name: string, arguments_: readonly ValueFacts[]) => calls.call(name, arguments_, env, expression),
            arity: (name: string) => env.get(name) === functionBindings.get(name)
                ? functions.get(name)?.parameters.length
                : env.get(name) === imported.get(name)?.binding
                    ? imported.get(name)?.functions.get(imported.get(name)!.name)?.parameters.length : undefined,
        });
        if (isParenthesizedExpression(expression)) inspect(expression.value, env);
        if (isMaterializeExpression(expression)) inspect(expression.source, env);
        if (isUnaryExpression(expression)) inspect(expression.operand, env);
        if (isRecordExpression(expression)) for (const field of expression.fields) inspect(field.value, env);
        if (isRecordUpdateExpression(expression)) {
            const source = inspect(expression.source, env);
            for (const field of expression.fields) {
                inspect(field.value, env);
                const expected = source.fields?.[field.name];
                if (expected) checkFieldAssignment(expected, field.value, field.operator, env, `record field .${field.name}`);
            }
        }
        if (isFirstWhereExpression(expression) || isFirstIndexWhereExpression(expression)
            || isTakeWhileExpression(expression)) {
            inspect(expression.source, env);
            inspect(expression.mask, env);
        }
        if (isBoundClauseExpression(expression)) {
            inspect(expression.source, env);
            inspect(expression.condition, env);
        }
        if (isCountClauseExpression(expression)) {
            inspect(expression.source, env);
            inspect(expression.count, env);
        }
        if (isArrayExpression(expression)) {
            for (const item of [...expression.items, ...expression.dimensions, ...expression.rows.flatMap(row => row.items)]) inspect(item.value, env);
            if (expression.fill) inspect(expression.fill, env);
            const shape = expressionFacts(expression, lookup).shape;
            if (expression.dimensions.length && !expression.fill && shape?.every(n => n !== null)) {
                const expected = shape.reduce<bigint>((size, n) => size * BigInt(n!), 1n);
                const actual = expression.items.length + expression.rows.reduce((count, row) => count + row.items.length, 0);
                if (expected !== BigInt(actual)) diagnostics.push({ node: expression, kind: 'DimensionMismatch',
                    message: `array shape ${shape.join(' ')} expects ${expected} elements, got ${actual}` });
            }
        }
        if (isApplicationExpression(expression)) {
            const parts = flattenApplication(expression);
            const source = inspect(parts[0], env);
            const renamed = renamedBuiltinCall(parts);
            const binding = renamed && env.get(renamed.operation.name);
            if (renamed && source.types.join() === renamed.receiver
                && (!binding || binding.builtinOperation === renamed.operation.name)) {
                diagnostics.push({ node: renamed.operation, kind: 'TypeError', code: 'BuiltinRename', message: renamed.message });
            }
            for (const part of parts.slice(1)) inspect(part, env);
            const selectors = parts.slice(1);
            const last = parts.at(-1);
            const fenwickSelector = source.types.join() === 'fenwick'
                && (selectors.length === 1 || selectors.length === 2
                    && isNameExpression(selectors[0]) && selectors[0].name === 'sum') ? last : undefined;
            const fenwickIndex = fenwickSelector && expressions.get(fenwickSelector);
            if (fenwickSelector && fenwickIndex?.types.length
                && fenwickIndex.types.every(type => type !== 'integer')) {
                diagnostics.push({ node: fenwickSelector, kind: 'TypeError',
                    message: `fenwick index must be integer, got ${fenwickIndex.types.join(' or ')}` });
            }
            if (isNameExpression(last) && last.name === 'reshape' && !lookup(last.name) && parts.length === 3) {
                const dimensions = expressionFacts(parts[1], lookup).integers;
                if (dimensions?.every(n => n !== null && n >= 0)
                    && source.shape?.every(n => n !== null)) {
                    const expected = dimensions.reduce<bigint>((size, n) => size * BigInt(n!), 1n);
                    const actual = source.shape.reduce<bigint>((size, n) => size * BigInt(n!), 1n);
                    if (expected !== actual) diagnostics.push({ node: expression, kind: 'DimensionMismatch',
                        message: `reshape expects ${expected} elements, got ${actual}` });
                }
            }
            if (source.rank !== undefined && source.types.length && source.types.every(type => type === 'array' || type === 'bytes')
                && selectors.every(part => isAllAxisExpression(part) || expressionFacts(part, lookup).types.join() === 'integer')
                && (selectors.some(isAllAxisExpression) || source.elements?.length
                    && source.elements.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type)))
                && selectors.length > source.rank) diagnostics.push({ node: expression, kind: 'DimensionMismatch',
                    message: `${selectors.length} selectors exceed array rank ${source.rank}` });
            for (let index = 1; index < parts.length - 1; index++) {
                const part = parts[index];
                if (!isNameExpression(part) || !['rank', 'axis'].includes(part.name) || lookup(part.name)) continue;
                const integer = expressionFacts(parts[index + 1], lookup).integer;
                if (integer === undefined || source.rank === undefined) continue;
                const value = BigInt(integer);
                if (value < 0n || (part.name === 'axis' ? value >= BigInt(source.rank) : value > BigInt(source.rank))) {
                    diagnostics.push({ node: parts[index + 1], kind: 'DimensionMismatch',
                        message: `${part.name} ${integer} is invalid for rank ${source.rank}` });
                }
            }
        }
        if (isApplicationExpression(expression)) raggedLiftWarning(expression, lookup);
        if (isBinaryExpression(expression)) {
            const left = inspect(expression.left, env);
            const right = inspect(expression.right, env);
            const modifiers = flattenApplication(expression.right);
            if (isNameExpression(modifiers[0]) && modifiers[0].name === 'reduce'
                && isNameExpression(modifiers[1]) && modifiers[1].name === 'rank' && modifiers[2]) {
                const integer = expressionFacts(modifiers[2], lookup).integer;
                if (integer !== undefined && left.rank !== undefined
                    && (BigInt(integer) < 0n || BigInt(integer) > BigInt(left.rank))) {
                    diagnostics.push({ node: modifiers[2], kind: 'DimensionMismatch',
                        message: `rank ${integer} exceeds value rank ${left.rank}` });
                }
            }
            if (['+', '-', '*', '/', '//', '%', '**'].includes(expression.operator)) {
                if (incompatibleShapes(left, right)) diagnostics.push({ node: expression, kind: 'DimensionMismatch',
                    message: `shape mismatch: [${left.shape!.join(', ')}] and [${right.shape!.join(', ')}]` });
                // Other scalar domains (dates/durations) have their own legal operators.
                const primitive = new Set(['integer', 'real', 'text', 'boolean']);
                const leftTypes = isAtom(left) ? left.types : left.shape?.every(n => n !== null && n > 0) ? left.elements ?? [] : [];
                const rightTypes = isAtom(right) ? right.types : right.shape?.every(n => n !== null && n > 0) ? right.elements ?? [] : [];
                if (leftTypes.length && rightTypes.length
                    && [...leftTypes, ...rightTypes].every(type => primitive.has(type))
                    && !leftTypes.some(a => rightTypes.some(b => numeric.has(a) && numeric.has(b)
                        || expression.operator === '+' && a === 'text' && b === 'text'))) {
                    diagnostics.push({ node: expression, kind: 'TypeError',
                        message: `operator ${expression.operator} does not accept ${leftTypes.join(' or ')} and ${rightTypes.join(' or ')}` });
                }
            }
        }
        const result = expressionFacts(expression, lookup);
        expressions.set(expression, result);
        if (result.bottom) throw new UnobservedReturn();
        return result;
    }

    /** The builtin that ends every `return` of a one-parameter function with no declared ranks, if all agree on a data-dependent length. */
    function raggedReturn(declared: FunctionStatement) {
        if (declared.parameters.length !== 1 || declared.ranks.length) return undefined;
        const returns = AstUtils.streamAllContents(declared).filter(isReturnStatement).toArray();
        let found;
        for (const item of returns) {
            if (!item.value) return undefined;
            const last = flattenApplication(item.value).at(-1);
            const operation = isNameExpression(last) && !declared.parameters.includes(last.name) && !functions.has(last.name)
                ? findOperation(last.name) : undefined;
            if (!operation || !dataDependentLength(operation)) return undefined;
            found ??= operation;
        }
        return found;
    }

    /** `F rank N` over a frame of several cells where F's result length depends on the values. */
    function raggedLiftWarning(expression: Expression, lookup: FactLookup): void {
        if (!isApplicationExpression(expression)) return;
        const parts = flattenApplication(expression);
        const modifier = parts.at(-2);
        if (parts.length !== 4 || !isNameExpression(modifier) || modifier.name !== 'rank' || lookup('rank')) return;
        const name = parts[1];
        if (!isNameExpression(name)) return;
        const declared = functions.get(name.name);
        const operation = declared ? undefined : lookup(name.name) ? undefined : findOperation(name.name);
        const source_ = declared ? raggedReturn(declared) : operation && dataDependentLength(operation) ? operation : undefined;
        if (!source_) return;
        const rank = expressionFacts(parts[3], lookup).integer;
        const source = expressions.get(parts[0]) ?? expressionFacts(parts[0], lookup);
        const sourceRank = source.shape?.length ?? source.acceptedArrayRank;
        if (rank === undefined || BigInt(rank) < 0n || sourceRank === undefined
            || source.types.length && source.types.join() !== 'array') return;
        const frame = source.shape?.slice(0, Math.max(0, sourceRank - Number(rank)))
            ?? Array<number | null>(Math.max(0, sourceRank - Number(rank))).fill(null);
        if (frame.length === 0 || frame.every(n => n !== null) && frame.reduce<number>((size, n) => size * n!, 1) <= 1) return;
        diagnostics.push({ node: modifier, kind: 'DimensionMismatch', code: 'RaggedLift', severity: 'warning',
            message: `\`${name.name}\` returns a data-dependent length${declared ? ` (from \`${source_.name}\`)` : ''}; under \`rank ${rank}\` the cells may differ in length `
                + `and fail at run time. Reduce inside a function you lift (\`fun Distinct Row ... Row ${source_.name} sum\`) or pad to a fixed width`});
    }

    function checkFieldAssignment(expected: ValueFacts, value: Expression, operator: string,
        env: Map<string, ValueFacts>, name: string): void {
        const received = operator === '=' ? expressionFacts(value, key => env.get(key))
            : expressionFacts({ $type: 'BinaryExpression', operator: operator.slice(0, -1),
                left: { $type: 'NameExpression', name: '$field' }, right: value } as Expression,
            key => key === '$field' ? expected : env.get(key));
        const conflict = recordFieldConflict(expected, received, name);
        if (conflict) diagnostics.push({ node: value, ...conflict });
    }

    // A direct call receives its already-evaluated arguments before its body
    // can invalidate caller facts. Limit this early snapshot to values whose
    // evaluation cannot itself call Rank or read host-owned array cells.
    function directCallBeforeEffects(value: Expression, env: Map<string, ValueFacts>): ValueFacts | undefined {
        if (!isApplicationExpression(value)) return undefined;
        const parts = flattenApplication(value);
        const target = parts.at(-1);
        const external = target && isNameExpression(target) ? imported.get(target.name) : undefined;
        if (external && isNameExpression(target) && env.get(target.name) === external.binding
            && external.functions.get(external.name)?.parameters.length === parts.length - 1
            && parts.slice(0, -1).every(directValue)) {
            return calls.call(target.name, parts.slice(0, -1).map(part => expressionFacts(part,
                name => env.get(name))), new Map(env), value);
        }
        if (!target || !isNameExpression(target) || env.get(target.name) !== functionBindings.get(target.name)
            || functions.get(target.name)?.parameters.length !== parts.length - 1) return undefined;
        const numericArgument = (part: Expression): boolean => {
            if (isParenthesizedExpression(part)) return numericArgument(part.value);
            if (isUnaryExpression(part) && ['+', '-'].includes(part.operator))
                return numericArgument(part.operand);
            if (isBinaryExpression(part) && ['+', '-', '*', '/', '//', '%', '**'].includes(part.operator))
                return numericArgument(part.left) && numericArgument(part.right);
            if (!isNameExpression(part) && !isNumberLiteral(part)) return false;
            const fact = isNameExpression(part) ? env.get(part.name) : expressionFacts(part, name => env.get(name));
            return fact?.rank === 0 && fact.types.length > 0
                && fact.types.every(type => type === 'integer' || type === 'real');
        };
        const safeIndexedScalar = (value: Expression): boolean => {
            while (isParenthesizedExpression(value)) value = value.value;
            if (!isApplicationExpression(value)) return false;
            const parts = flattenApplication(value);
            const source = isNameExpression(parts[0]) ? env.get(parts[0].name) : undefined;
            const cell = expressionFacts(value, name => env.get(name));
            return source?.types.join() === 'array' && safeRead(source)
                && parts.slice(1).every(numericArgument)
                && cell.rank === 0 && cell.types.length > 0 && cell.types.every(type => numeric.has(type));
        };
        const arguments_: ValueFacts[] = [];
        for (const part of parts.slice(0, -1)) {
            const atom = isParenthesizedExpression(part) ? part.value : part;
            if (!isNameExpression(atom) && !isNumberLiteral(atom) && !isStringLiteral(atom)
                && !isBooleanLiteral(atom) && !numericArgument(part) && !safeIndexedScalar(part)) return undefined;
            const fact = expressionFacts(part, name => env.get(name));
            if (!fact.types.length || fact.types.includes('function')
                || fact.types.includes('array') && !fact.eagerScalarCells && !fact.callbackFreeScalarCells) return undefined;
            arguments_.push(fact);
        }
        return calls.call(target.name, arguments_, new Map(env), value);
    }

    function statements(items: readonly Statement[], env: Map<string, ValueFacts>): boolean {
        for (const statement of items) {
            if (isAssignmentStatement(statement)) {
                const dot = statement.name.indexOf('.');
                if (dot > 0 && importedAliases.has(statement.name.slice(0, dot))) {
                    invalidateImportedAlias(statement.name.slice(0, dot), env);
                }
                const beforeEffects = statement.operator === '=' ? directCallBeforeEffects(statement.value, env) : undefined;
                invalidateCalls(statement.value, env);
                const previous = env.get(statement.name);
                let next = beforeEffects ?? inspect(statement.value, env);
                let constructor = statement.value;
                while (isParenthesizedExpression(constructor)) constructor = constructor.value;
                if (isNewStructureExpression(constructor)
                    && ['set', 'counter', 'queue', 'stack', 'deque', 'heap'].includes(constructor.structure)) {
                    next = { ...next, collectionId: nextCollectionId++ };
                }
                if (next.bottom) throw new UnobservedReturn();
                if (statement.operator !== '=') next = {
                    ...expressionFacts({ $type: 'BinaryExpression', operator: statement.operator.slice(0, -1),
                        left: { $type: 'NameExpression', name: statement.name }, right: statement.value } as Expression, name => env.get(name)),
                    types: compoundType(statement.operator, previous?.types ?? [], next.types),
                };
                const accepted = previous?.acceptedTypes ?? previous?.types;
                const expectedRank = contractRank(previous);
                const receivedRank = arrayRank(next);
                if (accepted?.length && provenBindingTypeConflict(accepted, next.types)) {
                    diagnostics.push({ node: statement.value, kind: 'TypeError',
                        message: bindingTypeMessage(statement.name, accepted, next.types) });
                } else if (expectedRank !== undefined && receivedRank !== undefined
                    && bindingRankConflict(expectedRank, receivedRank)) {
                    diagnostics.push({ node: statement.value, kind: 'DimensionMismatch',
                        message: bindingRankMessage(statement.name, expectedRank, receivedRank) });
                }
                // A successful assignment to an uncaptured scalar local must
                // satisfy its existing binding contract, even if the RHS is unknown.
                if (!next.types.length && accepted?.length && privateBindings.at(-1)?.has(statement.name)
                    && accepted.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))) {
                    next = { types: accepted, rank: 0, shape: [] };
                }
                env.set(statement.name, { ...next, acceptedTypes: accepted?.length ? accepted : next.types,
                    acceptedArrayRank: expectedRank ?? receivedRank });
                if (calls.directNoReturnCall(statement.value, env)) return false;
            } else if (isUnpackStatement(statement)) {
                invalidateCalls(statement.value, env);
                const source = inspect(statement.value, env);
                const knownCells = !!source.elements?.length || !!source.positionFacts?.length;
                if (source.types.join() !== 'array' || source.rank !== 1
                    || source.shape?.[0] != null && source.shape[0] !== statement.names.length
                    || !knownCells && source.positions?.length !== statement.names.length
                    || !(source.eagerScalarCells || source.callbackFreeScalarCells)) {
                    forgetNonFunctions(env);
                    continue;
                }
                for (const [index, name] of statement.names.entries()) {
                    if (name === '#') continue;
                    const cell = source.positionFacts?.[index];
                    const types = cell?.types ?? source.positions?.[index] ?? source.elements ?? [];
                    const previous = env.get(name);
                    const accepted = previous?.acceptedTypes ?? previous?.types;
                    if (accepted?.length && provenBindingTypeConflict(accepted, types)) {
                        diagnostics.push({ node: statement, kind: 'TypeError',
                            message: bindingTypeMessage(name, accepted, types) });
                    }
                    const scalarCell = types.length && types.every(type =>
                        ['integer', 'real', 'boolean', 'symbol', 'date', 'datetime', 'duration'].includes(type));
                    const textCell = types.join() === 'text';
                    env.set(name, { ...(cell ?? (scalarCell ? { rank: 0, shape: [] }
                            : textCell ? { rank: 1, shape: [null] } : {})),
                        types,
                        ...(source.integers?.[index] != null ? { integer: String(source.integers[index]) } : {}),
                        acceptedTypes: accepted ?? types,
                        ...(cell?.types.join() === 'array' ? { acceptedArrayRank: cell.rank } : {}) });
                }
            } else if (isAddStatement(statement)) {
                invalidateCalls(statement.value, env);
                if (!directValue(statement.value)) {
                    forgetNonFunctions(env);
                }
                const value = inspect(statement.value, env);
                if (!value.types.length || !value.types.every(type =>
                    ['integer', 'real', 'boolean', 'text', 'symbol', 'date', 'datetime'].includes(type))) {
                    forgetNonFunctions(env);
                }
            } else if (isIndexAssignmentStatement(statement)) {
                let safeKeys = true;
                for (const key of statement.keys) {
                    invalidateCalls(key, env);
                    if (!directValue(key)) {
                        forgetNonFunctions(env);
                    }
                    const fact = inspect(key, env);
                    safeKeys &&= directValue(key) && fact.types.length > 0
                        && fact.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol'].includes(type));
                }
                invalidateCalls(statement.value, env);
                const booleanValue = isBinaryExpression(statement.value)
                    && ['and', 'or', 'xor'].includes(statement.value.operator)
                    && [statement.value.left, statement.value.right].every(value => directValue(value)
                        && expressionFacts(value, name => env.get(name)).types.join() === 'boolean');
                const safeValue = directValue(statement.value) || safeIndexDefault(statement.value, env) || booleanValue
                    || scalarArithmetic(statement.value, env) || scalarBitwise(statement.value, env);
                if (!safeValue) {
                    forgetNonFunctions(env);
                }
                const replacement = inspect(statement.value, env);
                if (env.get('index')?.types.join() === 'index') {
                    for (const [name, fact] of env) if (fact.types.join() === 'index') {
                        env.set(name, { ...fact,
                            elements: fact.elements !== undefined && safeKeys && safeValue && replacement.types.length
                                ? [...new Set([...fact.elements, ...replacement.types])] : undefined });
                    }
                }
            } else if (isPushStatement(statement)) {
                const receiver = isNameExpression(statement.receiver) ? statement.receiver.name : undefined;
                for (const value of [statement.receiver, statement.value]) {
                    invalidateCalls(value, env);
                    if (!safeCollectionValue(value, env)) {
                        forgetNonFunctions(env);
                    }
                    inspect(value, env);
                }
                const payload = expressionFacts(statement.value, name => env.get(name));
                if (payload.types.includes('array') && !payload.eagerScalarCells && !payload.callbackFreeScalarCells) {
                    forgetNonFunctions(env);
                }
                if (receiver && safeCollectionValue(statement.value, env)) {
                    insertCollectionElement(receiver,
                        expressionFacts(statement.value, name => env.get(name)), statement.value, env);
                }
            } else if (isArrayAssignmentStatement(statement)) {
                const selectors = statement.indices.map(index => {
                    if (!index.value) return undefined;
                    invalidateCalls(index.value, env);
                    return inspect(index.value, env);
                });
                invalidateCalls(statement.value, env);
                const replacement = inspect(statement.value, env);
                const fact = env.get(statement.name);
                const fenwickIndex = statement.indices.length === 1 && !statement.indices[0].all
                    && !statement.indices[0].spread ? selectors[0] : undefined;
                const fenwickValueTypes = statement.operator === '=' ? replacement.types
                    : compoundType(statement.operator, ['integer'], replacement.types);
                const segmentValueTypes = statement.operator === '=' ? replacement.types
                    : compoundType(statement.operator, fact?.elements ?? [], replacement.types);
                if (fact?.types.join() === 'fenwick' && fenwickIndex?.types.length
                    && fenwickIndex.types.every(type => type !== 'integer')) {
                    diagnostics.push({ node: statement.indices[0].value!, kind: 'TypeError',
                        message: `fenwick index must be integer, got ${fenwickIndex.types.join(' or ')}` });
                } else if (fact?.types.join() === 'fenwick' && fenwickValueTypes.length
                    && fenwickValueTypes.every(type => type !== 'integer')) {
                    diagnostics.push({ node: statement.value, kind: 'TypeError',
                        message: `fenwick value must be integer, got ${fenwickValueTypes.join(' or ')}` });
                }
                const integerSelector = (value: Expression) => expressionFacts(value, name => env.get(name)).types.join() === 'integer';
                const spreadLength = (value: Expression): number | undefined => {
                    const selector = expressionFacts(value, name => env.get(name));
                    return selector.types.join() === 'array' && selector.rank === 1
                        && (selector.eagerScalarCells || selector.callbackFreeScalarCells)
                        && selector.elements?.join() === 'integer'
                        ? selector.shape?.[0] ?? undefined : undefined;
                };
                const selectorLengths = statement.indices.map(index => index.all || !index.value ? undefined
                    : index.spread ? spreadLength(index.value) : integerSelector(index.value) ? 1 : undefined);
                const oneCellSelectors = fact?.rank !== undefined
                    && selectorLengths.every(length => length !== undefined)
                    && selectorLengths.reduce((total, length) => total + (length ?? 0), 0) === fact.rank;
                const indexedCells = fact?.rank === 1 && statement.indices.length === 1
                    && !statement.indices[0].all && !statement.indices[0].spread
                    && ['array', 'sequence'].includes(selectors[0]?.types.join() ?? '')
                    && selectors[0]?.rank === 1 && selectors[0].elements?.join() === 'integer'
                    && (selectors[0].eagerScalarCells || selectors[0].callbackFreeScalarCells);
                const integerVector = (selector: ValueFacts | undefined): boolean => !!selector
                    && ['array', 'sequence'].includes(selector.types.join()) && selector.rank === 1
                    && selector.elements?.join() === 'integer'
                    && (selector.eagerScalarCells === true || selector.callbackFreeScalarCells === true);
                const lineTypes = statement.operator === '=' ? replacement.elements ?? []
                    : compoundType(statement.operator, fact?.elements ?? [], replacement.elements ?? []);
                const lineWrite = fact?.rank === statement.indices.length
                    && fact.eagerScalarCells === true && !!fact.elements?.length
                    && fact.elements.every(type => type === 'integer' || type === 'real')
                    && statement.indices.every((index, position) => !index.spread
                        && (index.all || selectors[position]?.rank === 0 && selectors[position]?.types.join() === 'integer'
                            || integerVector(selectors[position])))
                    && statement.indices.filter((index, position) => index.all || integerVector(selectors[position])).length === 1
                    && replacement.types.join() === 'array' && replacement.rank === 1
                    && (replacement.eagerScalarCells || replacement.callbackFreeScalarCells)
                    && !!replacement.elements?.length
                    && replacement.elements.every(type => type === 'integer' || type === 'real')
                    && lineTypes.length > 0 && lineTypes.every(type => type === 'integer' || type === 'real');
                const compound = statement.operator !== '=' && (oneCellSelectors || indexedCells)
                    && fact.eagerScalarCells === true
                    && !!fact.elements?.length && fact.elements.every(type => type === 'integer' || type === 'real')
                    && replacement.rank === 0 && replacement.types.length > 0
                    && replacement.types.every(type => type === 'integer' || type === 'real')
                    ? compoundType(statement.operator, fact.elements, replacement.types) : [];
                const lineCompound = statement.operator !== '=' && fact?.rank === statement.indices.length
                    && fact.eagerScalarCells === true && !!fact.elements?.length
                    && fact.elements.every(type => type === 'integer' || type === 'real')
                    && statement.indices.every((index, position) => !index.spread
                        && (index.all || selectors[position]?.rank === 0 && selectors[position]?.types.join() === 'integer'))
                    && statement.indices.filter(index => index.all).length === 1
                    && replacement.rank === 0 && replacement.types.length > 0
                    && replacement.types.every(type => type === 'integer' || type === 'real')
                    ? compoundType(statement.operator, fact.elements, replacement.types) : [];
                if (fact?.types.join() === 'fenwick' && statement.indices.length === 1
                    && !statement.indices[0].all && !statement.indices[0].spread
                    && fenwickIndex?.types.join() === 'integer'
                    && fenwickValueTypes.join() === 'integer') {
                    env.set(statement.name, fact);
                } else if (fact?.types.join() === 'record' && fact.fields
                    && statement.indices.length > 0 && statement.indices.every(index =>
                        !index.all && !index.spread && index.value && isLabelLiteral(index.value))) {
                    let expected: ValueFacts | undefined = fact;
                    const path: string[] = [];
                    for (const index of statement.indices) {
                        if (!index.value || !isLabelLiteral(index.value)) break;
                        const field = index.value.name;
                        path.push(`.${field}`);
                        expected = expected?.fields?.[field];
                    }
                    if (expected) checkFieldAssignment(expected, statement.value, statement.operator, env, `record field ${path.join(' ')}`);
                    if (replacement.types.includes('array') && !safeRead(replacement)) forgetNonFunctions(env);
                    for (const source of [env, globalCallEnvs.at(-1)]) if (source) for (const [name, value] of source) {
                        if (value.types.join() === 'record') source.set(name, { ...value, ...stableRecordField(value) });
                    }
                } else if (fact?.types.join() === 'segment' && fact.segmentOperation && fact.elements?.length
                    && (statement.indices.length === 1 || statement.indices.length === 2
                        && fact.segmentOperation === '+')
                    && statement.indices.every((index, position) => !index.all && !index.spread
                        && selectors[position]?.types.join() === 'integer')
                    && replacement.rank === 0 && replacement.types.length > 0
                    && replacement.types.every(type => type === 'integer' || type === 'real')
                    && (!['band', 'bor', 'bxor'].includes(fact.segmentOperation)
                        || replacement.types.every(type => type === 'integer'))
                    && segmentValueTypes.length > 0
                    && segmentValueTypes.every(type => type === 'integer' || type === 'real')) {
                    // Segment aliases may share storage, so widen every known numeric segment.
                    for (const source of [env, globalCallEnvs.at(-1)]) if (source) for (const [name, value] of source) {
                        if (value.types.join() === 'segment' && value.segmentOperation && value.elements?.length) {
                            source.set(name, { ...value,
                                elements: [...new Set([...value.elements, ...segmentValueTypes])] });
                        }
                    }
                } else if (fact?.types.join() === 'index' && statement.operator === '='
                    && statement.indices.every((index, position) => !index.all && !index.spread
                        && !!index.value && directValue(index.value) && !!selectors[position]?.types.length
                        && selectors[position]!.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol'].includes(type)))
                    && directValue(statement.value) && isAtom(replacement) && replacement.types.length > 0
                    && replacement.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol',
                        'date', 'datetime'].includes(type))) {
                    // Named indices may alias any other index, including the implicit local one.
                    for (const source of [env, globalCallEnvs.at(-1)]) if (source) for (const [name, value] of source) {
                        if (value.types.join() === 'index') source.set(name, { ...value,
                            elements: value.elements === undefined ? undefined
                                : [...new Set([...value.elements, ...replacement.types])] });
                    }
                } else if ((isPlainArrayWrite(statement, integerSelector)
                    || statement.operator === '=' && oneCellSelectors || compound.length > 0
                    || lineWrite || lineCompound.length > 0)
                    && fact?.types.length
                    && fact.types.every(type => type === 'array')) {
                    // Keep old element types as conservative possibilities;
                    // a known scalar replacement adds its possible types.
                    const oneCell = (oneCellSelectors || indexedCells) && isAtom(replacement)
                        && replacement.types.length > 0;
                    const safeCells = oneCell || lineWrite || lineCompound.length > 0;
                    env.set(statement.name, { ...fact,
                        elements: safeCells && fact.elements?.length
                            ? [...new Set([...fact.elements, ...(lineWrite ? lineTypes
                                : lineCompound.length ? lineCompound
                                    : compound.length ? compound : replacement.types)])] : undefined,
                        integers: undefined, positions: undefined, positionFacts: undefined,
                        callbackFreeScalarCells: undefined,
                        eagerScalarCells: safeCells && fact.eagerScalarCells
                            && (lineWrite || lineCompound.length > 0
                                || replacement.types.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type)))
                            ? true : undefined });
                } else {
                    forgetNonFunctions(env);
                }
            } else if (isExpressionStatement(statement)) {
                const parts = isApplicationExpression(statement.value)
                    ? flattenApplication(statement.value) : [];
                const key = parts[2] && expressionFacts(parts[2], name => env.get(name));
                const receiver = parts[0] && isNameExpression(parts[0]) ? env.get(parts[0].name) : undefined;
                const method = parts.at(-1);
                const safePayload = (node: Expression): boolean => {
                    const fact = expressionFacts(node, name => env.get(name));
                    return safeCollectionValue(node, env) && fact.types.length > 0
                        && (!fact.types.includes('array') || !!fact.eagerScalarCells || !!fact.callbackFreeScalarCells);
                };
                const dequeInsert = parts.length === 3 && receiver?.types.join() === 'deque'
                    && method && isNameExpression(method) && ['pushfront', 'pushback'].includes(method.name)
                    && !env.has(method.name) && safePayload(parts[1]);
                const heapInsert = parts.length === 4 && receiver?.types.join() === 'heap'
                    && method && isNameExpression(method) && method.name === 'enqueue' && !env.has('enqueue')
                    && directValue(parts[1]) && ['integer', 'real', 'text'].includes(expressionFacts(parts[1], name => env.get(name)).types.join())
                    && safePayload(parts[2]);
                const collectionRemove = parts.length === 3 && ['set', 'counter'].includes(receiver?.types.join() ?? '')
                    && isNameExpression(parts[1]) && parts[1].name === 'remove' && !env.has('remove')
                    && safePayload(parts[2]);
                const collectionAdd = parts.length === 3 && isNameExpression(parts[0])
                    && ['set', 'counter'].includes(env.get(parts[0].name)?.types.join() ?? '')
                    && isNameExpression(parts[1]) && parts[1].name === 'add' && !env.has('add')
                    && safeCollectionValue(parts[2], env) && key && (isAtom(key) && key.types.length > 0
                        && key.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol',
                            'date', 'datetime'].includes(type)) || key.types.join() === 'array'
                            && key.eagerScalarCells === true);
                if (!collectionAdd && !dequeInsert && !heapInsert && !collectionRemove) invalidateCalls(statement.value, env);
                inspect(statement.value, env);
                if (collectionAdd && isNameExpression(parts[0])) insertCollectionElement(parts[0].name,
                    key!, parts[2], env);
                if ((dequeInsert || heapInsert) && isNameExpression(parts[0])) {
                    const payload = parts[dequeInsert ? 1 : 2];
                    insertCollectionElement(parts[0].name, expressionFacts(payload, name => env.get(name)), payload, env);
                }
                if (calls.directNoReturnCall(statement.value, env)) return false;
            } else if (isArgumentStatement(statement)) {
                if (statement.defaultValue) invalidateCalls(statement.defaultValue, env);
                env.set(statement.name, invalidate(env.get(statement.name)));
            } else if (isUseStatement(statement) && statement.path && statement.alias && loadModule) {
                if (importedAliases.has(statement.alias)) {
                    invalidateImportedAlias(statement.alias, env);
                    continue;
                }
                const module = loadModule(statement.path);
                if (!module) continue;
                const definitions = new Map(module.statements.filter(isFunctionStatement)
                    .map(definition => [definition.name, definition]));
                importedAliases.add(statement.alias);
                for (const [name] of definitions) {
                    const qualified = `${statement.alias}.${name}`;
                    const binding: ValueFacts = { types: ['function'] };
                    env.set(qualified, binding);
                    imported.set(qualified, { program: module, name, binding, functions: definitions });
                }
            } else if (isUseStatement(statement) && !statement.path) {
                // Opening a standard module does not alter existing bindings.
            } else if (isFunctionStatement(statement)) {
                const fact = { types: ['function'] };
                env.set(statement.name, fact);
                functionBindings.set(statement.name, fact);
                functions.set(statement.name, statement);
                if (functionYields(statement).length) {
                    const { yields, cells } = generatorCells(statement,
                        statement.parameters.map(() => UNKNOWN_VALUE));
                    const known = yieldTypes(cells);
                    if (known.length > 1) diagnostics.push({ node: yields.find((_, index) =>
                        yieldTypes(cells.slice(0, index + 1)).length > 1)?.value ?? statement,
                        kind: 'TypeError', message: `${statement.name} yields incompatible types: ${known.join(' and ')}` });
                }
            } else if (isIfStatement(statement)) {
                const paths = conditionalPaths(statement, env, diagnostics, inspect, invalidateCalls);
                const survivors: Map<string, ValueFacts>[] = [];
                for (const path of paths) {
                    const start = diagnostics.length;
                    if (statements(path.items, path.env)) survivors.push(path.env);
                    if (paths.length > 1) diagnostics.length = start;
                }
                if (!survivors.length) return false;
                // A terminating branch may have changed a captured binding before
                // it terminates; keep that possibility for later diagnostics.
                mergeEnvironments(env, paths.map(path => path.env));
            } else if (isForStatement(statement)) {
                loops.loop(statement, env);
            } else if (isTryStatement(statement)) {
                if (!paths.returnPaths([statement], env).fallsThrough) return false;
            } else {
                // Unsupported statements may mutate bindings through closures or imports.
                for (const [name, fact] of env) env.set(name, invalidate(fact));
            }
        }
        return true;
    }

    statements(program.statements, bindings);
    const functionResults = examples.map(example => {
        calls.resetBudget();
        return calls.call(example.name, example.arguments, bindings);
    });
    calls.validateDeclarations(bindings);
    const unique = diagnostics.filter((diagnostic, index) => !diagnostics.slice(0, index).some(previous =>
        previous.node === diagnostic.node && previous.message === diagnostic.message));
    return { diagnostics: unique, bindings, expressions, functions, functionResults };
}

function dataDependentLength(operation: Operation): boolean {
    return operation.dataLength === true || !!operation.shape?.find(shape => shape.args.length === 1)?.result
        ?.some(term => term !== null && typeof term === 'object' && 'exists' in term);
}
