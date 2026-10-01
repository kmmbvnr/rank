import { AstUtils, type AstNode } from 'langium';
import {
    isAddStatement, isApplicationExpression, isArrayAssignmentStatement, isAssignmentStatement,
    isBinaryExpression, isBooleanLiteral, isBreakStatement, isContinueStatement,
    isExpression, isExpressionStatement, isForStatement, isFunctionStatement, isIfStatement,
    isIndexAssignmentStatement, isNameExpression, isNewStructureExpression,
    isParenthesizedExpression, isPushStatement, isStatement, isStdinExpression,
    isTryStatement, isUnpackStatement,
    type Expression, type ForStatement, type FunctionStatement, type Statement,
} from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';
import { type Types } from './types.js';
import { contractRank, invalidate, loopBinding, mergeEnvironments, settledShape } from './control-flow.js';
import { functionEffects } from './function-effects.js';
import { expressionFacts } from './value-facts.js';
import { directValue, safeEmptyArrayIteration, safeIndexedIteration, safeIndexedSource, safeRead } from './value-safety.js';
import { UNKNOWN_VALUE, type ValueFacts } from './value-domain.js';
import type { ReturnPaths } from './return-paths.js';

interface LoopAnalysisContext {
    diagnostics: { node: AstNode; message: string; kind: 'TypeError' | 'DimensionMismatch' }[];
    expressions: Map<Expression, ValueFacts>;
    functions: Map<string, FunctionStatement>;
    functionBindings: Map<string, ValueFacts | undefined>;
    globalEnv(): Map<string, ValueFacts> | undefined;
    inspect(expression: Expression, env: Map<string, ValueFacts>): ValueFacts;
    invalidateCalls(expression: AstNode, env: Map<string, ValueFacts>): void;
    statements(items: readonly Statement[], env: Map<string, ValueFacts>): boolean;
    returnPaths(items: readonly Statement[], env: Map<string, ValueFacts>): ReturnPaths;
    forgetNonFunctions(env: Map<string, ValueFacts>): void;
}

/** Loop-specific widening, closure proofs and return paths. */
export function createLoopAnalysis(context: LoopAnalysisContext) {
    const { diagnostics, expressions, functions, functionBindings, inspect, invalidateCalls,
        statements, returnPaths, forgetNonFunctions } = context;
    function emptyBuiltinRange(source: Expression | undefined, collection: ValueFacts): boolean {
        while (source && isParenthesizedExpression(source)) source = source.value;
        return !!source && isBinaryExpression(source)
            && (source.operator === 'to' || source.operator === 'till')
            && collection.types.join() === 'sequence'
            && collection.shape?.[0] === 0;
    }

    const writtenBindings = (node: AstNode): readonly string[] => isAssignmentStatement(node) ? [node.name]
        : isUnpackStatement(node) ? node.names.filter(name => name !== '#') : [];
    function widenArrayWrite(node: AstNode, env: Map<string, ValueFacts>): void {
        if (!isArrayAssignmentStatement(node)) return;
        const fact = env.get(node.name);
        if (fact && fact.types.join() !== 'segment') env.set(node.name, { ...fact,
            elements: undefined, positions: undefined, positionFacts: undefined, integers: undefined,
            eagerScalarCells: undefined, callbackFreeScalarCells: undefined });
    }
    function widenLoopExit(contents: readonly AstNode[], env: Map<string, ValueFacts>, preserved: ReadonlySet<string> = new Set()): void {
        for (const node of contents) {
            for (const name of writtenBindings(node)) {
                const fact = env.get(name);
                const rank = contractRank(fact);
                env.set(name, preserved.has(name) ? { ...fact, types: fact?.types ?? [], interval: undefined,
                    shape: rank === undefined ? undefined : Array(rank).fill(null),
                    integers: undefined, positions: undefined, positionFacts: undefined }
                    : { types: fact?.acceptedTypes ?? [], acceptedTypes: fact?.acceptedTypes,
                        acceptedArrayRank: rank, ...settledShape(fact?.acceptedTypes ?? [], rank) });
            }
            if (!isArrayAssignmentStatement(node) || !preserved.has(node.name)) widenArrayWrite(node, env);
        }
    }
    function bindIteration(env: Map<string, ValueFacts>, names: readonly string[], collection: ValueFacts): void {
        if (names[0] !== '#') {
            if (collection.types.join() === 'array' && collection.rank !== undefined && collection.rank > 1) {
                env.set(names[0], { types: ['array'], acceptedTypes: ['array'],
                    rank: collection.rank - 1, acceptedArrayRank: collection.rank - 1,
                    shape: collection.shape?.slice(1) ?? Array(collection.rank - 1).fill(null),
                    ...(collection.eagerScalarCells || collection.callbackFreeScalarCells
                        ? { elements: collection.elements, callbackFreeScalarCells: true as const } : {}) });
            } else {
                const types = collection.elements ?? (collection.types.join() === 'text' ? ['text'] : []);
                env.set(names[0], { types, acceptedTypes: types,
                    ...(types.length && types.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))
                        ? { rank: 0, shape: [] } : types.join() === 'text' ? { rank: 1, shape: [null] }
                            : types.join() === 'array' && collection.elementRank !== undefined
                                ? { rank: collection.elementRank, acceptedArrayRank: collection.elementRank,
                                    shape: Array(collection.elementRank).fill(null), elements: collection.elementCells } : {}) });
            }
        }
        if (names[1] && names[1] !== '#') env.set(names[1], {
            types: ['integer'], acceptedTypes: ['integer'], rank: 0, shape: [],
        });
    }

    function loop(statement: ForStatement, env: Map<string, ValueFacts>): void {
        const condition = statement.condition;
        if (condition && isBooleanLiteral(condition) && !condition.value) return;
        const candidate = loopBinding(condition);
        const source = candidate?.iterable ?? condition;
        if (source) invalidateCalls(source, env);
        const collection = source ? inspect(source, env) : UNKNOWN_VALUE;
        const membership = candidate && (candidate.names.length === 1
            || safeIndexedIteration(collection) && safeIndexedSource(candidate.iterable)
            || safeEmptyArrayIteration(candidate.iterable, collection)) ? candidate : undefined;
        const count = membership && collection.rank !== undefined && collection.rank > 0
            ? collection.shape?.[0] : undefined;
        if (count === 0) {
            if (!emptyBuiltinRange(source, collection)
                && !safeEmptyArrayIteration(source, collection)
                && !(source && safeIndexedIteration(collection) && safeIndexedSource(source))) {
                forgetNonFunctions(env);
            }
            return;
        }
        const contents = [...AstUtils.streamAllContents(statement)];
        const hasExit = contents.some(node => isBreakStatement(node) || isContinueStatement(node));
        if (condition && isBinaryExpression(condition) && condition.operator === 'in' && !membership
            || contents.some(node => isStatement(node) && !isExpression(node) && !isAssignmentStatement(node)
                && !isUnpackStatement(node) && !isArrayAssignmentStatement(node) && !isIndexAssignmentStatement(node)
                && !isAddStatement(node) && !isPushStatement(node) && !isExpressionStatement(node)
                && !isIfStatement(node) && !isForStatement(node) && !isTryStatement(node)
                && !isBreakStatement(node) && !isContinueStatement(node))) {
            // Mutation and non-local exits need their own flow rules.
            forgetNonFunctions(env);
            return;
        }
        const writes = new Set(contents.filter(isArrayAssignmentStatement).map(node => node.name));
        const writesIndex = contents.some(isIndexAssignmentStatement);
        const rebound = new Set(contents.flatMap(writtenBindings));
        const touchesIndex = writesIndex || [...writes].some(name => env.get(name)?.types.join() === 'index'
            || rebound.has(name) || !env.has(name));
        const knownIndices = touchesIndex ? [...env.values()].filter(fact => fact.types.join() === 'index') : [];
        const indexCandidate = knownIndices.length && knownIndices.every(fact => fact.elements !== undefined)
            ? [...new Set(knownIndices.flatMap(fact => fact.elements!))] : undefined;
        const candidates = new Map([...writes].flatMap(name => {
            const fact = env.get(name);
            return !rebound.has(name) && fact?.types.join() === 'array' && fact.rank !== undefined && fact.rank > 0
                && fact.eagerScalarCells && fact.elements?.length
                ? [[name, fact] as const] : [];
        }));
        const numeric = new Map([...rebound].flatMap(name => {
            const fact = env.get(name);
            return !writes.has(name) && fact?.types.join() === 'array' && fact.rank !== undefined && fact.rank > 0
                && (fact.eagerScalarCells || fact.callbackFreeScalarCells)
                && fact.elements?.length && fact.elements.every(type => type === 'integer' || type === 'real')
                ? [[name, { ...fact, shape: Array(fact.rank).fill(null), dims: undefined, dim: undefined, elements: fact.elements as Types,
                    eagerScalarCells: undefined, callbackFreeScalarCells: true as const,
                    integers: undefined, positions: undefined, positionFacts: undefined }] as const] : [];
        }));
        const inserts = contents.some(node => isPushStatement(node) || isNameExpression(node)
            && (functions.has(node.name) || ['pushfront', 'pushback', 'enqueue', 'add'].includes(node.name)));
        const prepare = (preserved: ReadonlySet<string>, indexSeed?: readonly string[],
            numericSeeds: ReadonlyMap<string, ValueFacts> = new Map(),
            arraySeeds: ReadonlyMap<string, ValueFacts> = candidates): Map<string, ValueFacts> => {
            const local = new Map(env);
            for (const name of preserved) if (arraySeeds.has(name)) local.set(name, arraySeeds.get(name)!);
            // Other writes still widen before the body: a later iteration may
            // observe a different value. Preserved cells need a closure proof.
            for (const node of contents) {
                for (const name of writtenBindings(node)) {
                    const previous = local.get(name);
                    const types = previous?.acceptedTypes ?? previous?.types ?? [];
                    const rank = contractRank(previous);
                    local.set(name, numericSeeds.get(name) ?? { types, acceptedTypes: types, acceptedArrayRank: rank,
                        ...settledShape(types, rank) });
                }
                if (!isArrayAssignmentStatement(node) || !preserved.has(node.name)
                    && !(indexSeed !== undefined && local.get(node.name)?.types.join() === 'index')) {
                    widenArrayWrite(node, local);
                }
            }
            if (touchesIndex) {
                for (const [name, fact] of local) if (fact.types.join() === 'index') {
                    local.set(name, { ...fact, elements: indexSeed });
                }
            }
            // A later iteration sees what this one inserted, so the schema of earlier insertions is not enough.
            if (inserts) for (const [name, fact] of local) if (fact.elementRecord) {
                local.set(name, { ...fact, elementRecord: undefined });
            }
            if (membership) bindIteration(local, membership.names, collection);
            return local;
        };
        const start = diagnostics.length;
        let preserved = new Set<string>();
        let local: Map<string, ValueFacts>;
        const preview = prepare(new Set(candidates.keys()), indexCandidate, numeric);
        const indexWriteTypes = indexCandidate === undefined ? undefined
            : contents.flatMap(node => {
                if (!isIndexAssignmentStatement(node) && (!isArrayAssignmentStatement(node)
                    || preview.get(node.name)?.types.join() !== 'index')) return [];
                const value = expressionFacts(node.value, name => preview.get(name));
                return value.types;
            });
        const effects = functionEffects(name => preview.get(name) === functionBindings.get(name)
            ? functions.get(name) : undefined, name => preview.get(name)?.types.includes('function') ?? false,
        name => preview.has(name), name => preview.get(name));
        const safeCalls = contents.filter(isNameExpression).filter(node =>
            AstUtils.getContainerOfType(node, isForStatement) === statement
                && preview.get(node.name)?.types.includes('function'))
            .every(node => {
                if (indexCandidate !== undefined && !candidates.size && !numeric.size
                    && AstUtils.getContainerOfType(node, isTryStatement)) return true;
                let site: AstNode = node;
                while (isApplicationExpression(site.$container)) site = site.$container;
                const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                if (parts.at(-1) !== node || parts.length - 1 !== functions.get(node.name)?.parameters.length
                    || !parts.slice(0, -1).every(directValue)) return false;
                const inputs = parts.slice(0, -1).map(part => expressionFacts(part, name => preview.get(name)));
                const effect = effects(node.name, inputs);
                return !effect.unknown && !effect.io && !effect.parameters.size && !effect.reboundParameters.size
                    && [...effect.captures].every(name => effect.numericCaptureWrites?.has(name)
                        && safeRead(preview.get(name)))
                    && !effect.bindingCaptures.size && [...effect.valueCaptures].every(name => {
                        const value = effect.globalValueCaptures.has(name)
                            ? (context.globalEnv() ?? preview).get(name) : preview.get(name);
                        return value?.rank === 0 && value.types.length > 0
                            && value.types.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type));
                    })
                    && [...effect.readCaptures].every(name => safeRead(preview.get(name)))
                    && [...effect.readParameters].every(index => safeRead(inputs[index]));
            });
        if (hasExit) {
            const before = new Map(contents.filter(isExpression).map(node => [node, expressions.get(node)] as const));
            const run = (keep: ReadonlySet<string>) => {
                const body = prepare(keep);
                const paths = returnPaths(statement.statements, body);
                return [...paths.breaks, ...paths.continues, ...(paths.fallsThrough ? [body] : [])];
            };
            let exits = candidates.size > 0 && safeCalls ? run(new Set(candidates.keys())) : [];
            const closed = exits.length > 0 && exits.every(path => [...candidates].every(([name, fact]) => {
                const after = path.get(name);
                return after?.types.join() === 'array' && after.rank === fact.rank && after.eagerScalarCells
                    && after.elements?.length && after.elements.every(type => fact.elements!.includes(type));
            }));
            if (closed) preserved = new Set(candidates.keys());
            else {
                diagnostics.length = start;
                for (const [node, prior] of before) {
                    if (prior) expressions.set(node, prior);
                    else expressions.delete(node);
                }
                exits = run(preserved);
            }
            if (count == null || count <= 0) diagnostics.length = start;
            for (const path of exits) widenLoopExit(contents, path, preserved);
            mergeEnvironments(env, [env, ...exits]);
            return;
        }
        if ((candidates.size || numeric.size || indexCandidate !== undefined) && safeCalls) {
            const before = new Map(contents.filter(isExpression).map(node => [node, expressions.get(node)] as const));
            const restore = () => {
                diagnostics.length = start;
                for (const node of contents.filter(isExpression)) {
                    const prior = before.get(node);
                    if (prior) expressions.set(node, prior);
                    else expressions.delete(node);
                }
            };
            let seed = indexCandidate && [...new Set([...indexCandidate, ...(indexWriteTypes ?? [])])];
            if (seed !== undefined) {
                const first = prepare(new Set(candidates.keys()), seed, numeric);
                statements(statement.statements, first);
                const indices = [...env].filter(([, fact]) => fact.types.join() === 'index')
                    .map(([name]) => first.get(name));
                seed = indices.every(fact => fact?.types.join() === 'index' && fact.elements !== undefined)
                    ? [...new Set(indices.flatMap(fact => fact!.elements!))] : undefined;
                restore();
            }
            const attempt = (arrays: ReadonlyMap<string, ValueFacts>) => {
                const trial = prepare(new Set(candidates.keys()), seed, numeric, arrays);
                statements(statement.statements, trial);
                const indexAfter = [...env].filter(([, fact]) => fact.types.join() === 'index')
                    .map(([name]) => trial.get(name));
                const closed = [...arrays].every(([name, fact]) => {
                    const after = trial.get(name);
                    return after?.types.join() === 'array' && after.rank === fact.rank && after.eagerScalarCells
                        && after.elements?.length === fact.elements!.length
                        && after.elements.every(type => fact.elements!.includes(type));
                }) && [...numeric].every(([name, fact]) => {
                    const after = trial.get(name);
                    return after?.types.join() === 'array' && after.rank === fact.rank
                        && (after.eagerScalarCells || after.callbackFreeScalarCells)
                        && after.elements?.length && after.elements.every(type => fact.elements!.includes(type));
                }) && (indexCandidate === undefined || seed !== undefined
                    && indexAfter.every(fact => fact?.types.join() === 'index' && fact.elements !== undefined
                        && fact.elements.every(type => seed!.includes(type))));
                return { trial, closed };
            };
            let { trial, closed } = attempt(candidates);
            if (!closed && (numeric.size || [...candidates.values()].some(fact => fact.elements?.every(type =>
                type === 'integer' || type === 'real')))) {
                restore();
                const widened = new Map([...candidates].map(([name, fact]) => [name,
                    fact.elements?.every(type => type === 'integer' || type === 'real')
                        ? { ...fact, elements: ['integer', 'real'] as Types } : fact] as const));
                for (const [name, fact] of numeric) numeric.set(name, { ...fact, elements: ['integer', 'real'] });
                ({ trial, closed } = attempt(widened));
            }
            if (closed) {
                local = trial;
                preserved = new Set([...candidates.keys(), ...numeric.keys(),
                    ...(indexCandidate !== undefined ? [...env].filter(([, fact]) => fact.types.join() === 'index')
                        .map(([name]) => name) : [])]);
            } else {
                restore();
                local = prepare(preserved);
                statements(statement.statements, local);
            }
        } else {
            local = prepare(preserved);
            statements(statement.statements, local);
        }
        if (count == null || count <= 0) diagnostics.length = start;
        // No final-iteration dimensions are proven. Keep contracts, not body values.
        widenLoopExit(contents, local, preserved);
        mergeEnvironments(env, [env, local]);
    }

    function loopReturnPaths(statement: ForStatement, env: Map<string, ValueFacts>): { values: ValueFacts[]; fallsThrough: boolean } {
        const condition = statement.condition;
        if (condition && isBooleanLiteral(condition) && !condition.value) return { values: [], fallsThrough: true };
        const candidate = loopBinding(condition);
        const source = candidate?.iterable ?? condition;
        if (source) invalidateCalls(source, env);
        const collection = source ? inspect(source, env) : UNKNOWN_VALUE;
        const membership = candidate && (candidate.names.length === 1
            || safeIndexedIteration(collection) && safeIndexedSource(candidate.iterable)
            || safeEmptyArrayIteration(candidate.iterable, collection)) ? candidate : undefined;
        const count = membership && collection.rank !== undefined && collection.rank > 0
            ? collection.shape?.[0] : undefined;
        if (count === 0) {
            if (!emptyBuiltinRange(source, collection)
                && !safeEmptyArrayIteration(source, collection)
                && !(source && safeIndexedIteration(collection) && safeIndexedSource(source))) {
                for (const [name, fact] of env) env.set(name, invalidate(fact));
            }
            return { values: [], fallsThrough: true };
        }
        const contents = [...AstUtils.streamAllContents(statement)];
        const rebound = new Set(contents.flatMap(writtenBindings));
        const indexWrites = contents.filter(isArrayAssignmentStatement);
        const indexNames = [...env].filter(([, fact]) => fact.types.join() === 'index');
        const owner = AstUtils.getContainerOfType(statement, isFunctionStatement);
        const directIndex = owner?.statements.indexOf(statement) ?? -1;
        const preceding = directIndex >= 0 ? owner!.statements.slice(0, directIndex) : [];
        const precedingWrites = preceding.flatMap(node => [node, ...AstUtils.streamAllContents(node)]);
        const closedIndexCandidate = indexWrites.length > 0 && indexNames.length > 0
            && indexNames.every(([, fact]) => fact.elements !== undefined)
            && ![...(context.globalEnv()?.values() ?? [])].some(fact => fact.types.join() === 'index')
            && indexWrites.every(write => {
                if (write.operator !== '=' || env.get(write.name)?.types.join() !== 'index') return false;
                const binding = precedingWrites.filter(node => writtenBindings(node).includes(write.name)
                    || isForStatement(node) && loopBinding(node.condition)?.names.includes(write.name)).at(-1);
                return !!binding && isAssignmentStatement(binding) && binding.operator === '='
                    && isNewStructureExpression(binding.value) && binding.value.structure === 'index';
            })
            && !contents.some(node => isIndexAssignmentStatement(node) || isForStatement(node)
                || isTryStatement(node) || isFunctionStatement(node) || isExpressionStatement(node)
                || isAddStatement(node) || isPushStatement(node) || isUnpackStatement(node)
                || isStdinExpression(node))
            && contents.filter(isNameExpression).every(node => env.get(node.name)?.types.length
                && env.get(node.name)!.types.every(type => ['integer', 'real', 'boolean', 'index'].includes(type)));
        const touchesIndex = contents.some(node => isIndexAssignmentStatement(node)
            || isArrayAssignmentStatement(node) && (env.get(node.name)?.types.join() === 'index'
                || rebound.has(node.name) || !env.has(node.name)));
        const prepare = (seed?: readonly string[]): Map<string, ValueFacts> => {
            const local = new Map(env);
            if (touchesIndex) for (const [name, fact] of local) if (fact.types.join() === 'index') {
                local.set(name, { ...fact, elements: seed });
            }
            for (const node of contents) {
                for (const name of writtenBindings(node)) {
                    const previous = local.get(name);
                    const types = previous?.acceptedTypes ?? previous?.types ?? [];
                    const rank = contractRank(previous);
                    local.set(name, { types, acceptedTypes: types, acceptedArrayRank: rank,
                        ...settledShape(types, rank) });
                }
                if (!isArrayAssignmentStatement(node) || seed === undefined
                    || local.get(node.name)?.types.join() !== 'index') widenArrayWrite(node, local);
            }
            if (membership) bindIteration(local, membership.names, collection);
            return local;
        };
        const start = diagnostics.length;
        let local = prepare();
        let returned: ReturnPaths;
        if (closedIndexCandidate) {
            const seed = [...new Set([...indexNames.flatMap(([, fact]) => fact.elements!),
                ...indexWrites.flatMap(write => expressionFacts(write.value, name => local.get(name)).types)])];
            const before = new Map(contents.filter(isExpression).map(node => [node, expressions.get(node)] as const));
            local = prepare(seed);
            returned = returnPaths(statement.statements, local);
            const continuing = [...returned.continues, ...(returned.fallsThrough ? [local] : [])];
            const closed = continuing.every(path => indexNames.every(([name]) => {
                const fact = path.get(name);
                return fact?.types.join() === 'index' && fact.elements !== undefined
                    && fact.elements.every(type => seed.includes(type));
            }));
            if (!closed) {
                diagnostics.length = start;
                for (const [node, prior] of before) {
                    if (prior) expressions.set(node, prior);
                    else expressions.delete(node);
                }
                local = prepare();
                returned = returnPaths(statement.statements, local);
            }
        } else returned = returnPaths(statement.statements, local);
        if (count == null || count <= 0) diagnostics.length = start;
        const exits = [...returned.breaks, ...returned.continues, ...(returned.fallsThrough ? [local] : [])];
        if (exits.length) {
            for (const path of exits) widenLoopExit(contents, path);
            mergeEnvironments(env, [env, ...exits]);
        }
        return { values: returned.values, fallsThrough: !(count != null && count > 0
            && !returned.fallsThrough && !returned.breaks.length && !returned.continues.length) };
    }

    return { loop, loopReturnPaths };
}
