import { AstUtils, type AstNode } from 'langium';
import {
    isApplicationExpression, isAllAxisExpression, isNameExpression, isNumberLiteral, isStringLiteral, isParenthesizedExpression,
    isArrayExpression, isMaterializeExpression, isUnaryExpression, isBooleanLiteral, isLabelLiteral,
    isArrayAssignmentStatement, isAssignmentStatement, isIndexAssignmentStatement, isBinaryExpression,
    isExpressionStatement, isStatement, isExpression,
    isBreakStatement, isContinueStatement, isForStatement, isFunctionStatement, isIfStatement, isReturnStatement, isStdinExpression,
    isAddStatement, isPushStatement, isTryStatement, isUnpackStatement, isYieldStatement,
    type Expression, type Program, type Statement, type FunctionStatement, type IfStatement, type ForStatement,
    type YieldStatement,
} from '../generated/ast.js';
import { compoundType, type Types } from './types.js';
import { flattenApplication, inlineSliceOperands } from '../expressions.js';
import { findOperation } from '../operations.js';
import { functionEffects, isPlainArrayWrite } from './function-effects.js';
import { functionYields } from './function-yields.js';
import { expressionFacts, incompatibleShapes, isAtom, joinValueFacts, UNKNOWN_VALUE, type ValueFacts, type FactLookup } from './value-facts.js';

export interface ValueDiagnostic {
    readonly node: AstNode;
    readonly message: string;
    readonly kind: 'TypeError' | 'DimensionMismatch';
}

export interface ValueAnalysis {
    readonly diagnostics: readonly ValueDiagnostic[];
    readonly bindings: ReadonlyMap<string, ValueFacts>;
    readonly expressions: ReadonlyMap<Expression, ValueFacts>;
    readonly functions: ReadonlyMap<string, FunctionStatement>;
    readonly functionResults: readonly ValueFacts[];
}

/** A non-executing pass. Unknown facts never justify a diagnostic. */
export function analyzeValues(program: Program, initial: ReadonlyMap<string, ValueFacts> = new Map(),
    declarations: ReadonlyMap<string, FunctionStatement> = new Map(),
    examples: readonly { name: string; arguments: readonly ValueFacts[] }[] = []): ValueAnalysis {
    const diagnostics: ValueDiagnostic[] = [];
    const expressions = new Map<Expression, ValueFacts>();
    const bindings = new Map(initial);
    const numeric = new Set(['integer', 'real']);
    const functions = new Map(declarations);
    const functionBindings = new Map([...functions.keys()].map(name => [name, bindings.get(name)]));
    const activeCalls = new Set<string>();
    const globalCallEnvs: Map<string, ValueFacts>[] = [];
    const noReturnFunctions = new WeakMap<FunctionStatement, boolean>();
    let remainingCalls = 100;
    const privateParameters: Set<string>[] = [];

    function directNoReturnCall(expression: Expression, env: ReadonlyMap<string, ValueFacts>): boolean {
        const parts = isApplicationExpression(expression) ? flattenApplication(expression) : [expression];
        const target = parts.at(-1);
        if (!target || !isNameExpression(target)) return false;
        const definition = functions.get(target.name);
        if (!definition || env.get(target.name) !== functionBindings.get(target.name)
            || definition.parameters.length !== parts.length - 1) return false;
        let noReturn = noReturnFunctions.get(definition);
        if (noReturn === undefined) {
            noReturn = !functionYields(definition).length && ![...AstUtils.streamAllContents(definition)]
                .some(node => isReturnStatement(node)
                    && AstUtils.getContainerOfType(node, isFunctionStatement) === definition);
            noReturnFunctions.set(definition, noReturn);
        }
        return noReturn;
    }

    const arrayRank = (fact: ValueFacts | undefined): number | undefined =>
        fact?.types.length && fact.types.every(type => type === 'array' || type === 'bytes') ? fact.rank : undefined;
    const contractRank = (fact: ValueFacts | undefined): number | undefined => fact?.acceptedArrayRank ?? arrayRank(fact);
    const invalidate = (fact: ValueFacts | undefined): ValueFacts => ({ types: [], acceptedArrayRank: contractRank(fact) });

    function mergeEnvironments(env: Map<string, ValueFacts>, paths: readonly Map<string, ValueFacts>[]): void {
        const names = new Set(paths.flatMap(path => [...path.keys()]));
        for (const name of names) {
            const facts = paths.map(path => path.get(name) ?? UNKNOWN_VALUE);
            const first = facts[0];
            if (facts.every(fact => fact === first)) { env.set(name, first); continue; }
            const rank = contractRank(first);
            const accepted = facts.map(fact => ({ types: fact.acceptedTypes ?? fact.types }));
            env.set(name, { ...joinValueFacts(facts), acceptedTypes: joinValueFacts(accepted).types,
                acceptedArrayRank: facts.every(fact => contractRank(fact) === rank) ? rank : undefined });
        }
    }

    function conditionalPaths(statement: IfStatement, env: Map<string, ValueFacts>): { items: readonly Statement[]; env: Map<string, ValueFacts> }[] {
        const paths: { items: readonly Statement[]; env: Map<string, ValueFacts> }[] = [];
        const pending = new Map(env);
        for (const clause of [{ condition: statement.condition, statements: statement.thenStatements }, ...statement.elifClauses]) {
            invalidateCalls(clause.condition, pending);
            const start = diagnostics.length;
            inspect(clause.condition, pending);
            if (paths.length) diagnostics.length = start;
            if (isBooleanLiteral(clause.condition) && !clause.condition.value) continue;
            paths.push({ items: clause.statements, env: new Map(pending) });
            if (isBooleanLiteral(clause.condition) && clause.condition.value) return paths;
        }
        paths.push({ items: statement.elseStatements, env: pending });
        return paths;
    }

    function generatorCells(definition: FunctionStatement, arguments_: readonly ValueFacts[]): {
        yields: readonly YieldStatement[]; cells: readonly ValueFacts[];
    } {
        const yields = functionYields(definition, true);
        // Parameters keep their input facts only when no supported path can
        // rebind them before a yield. Captures may change while suspended.
        const nodes = [...AstUtils.streamAllContents(definition)];
        const stableParameters = nodes.some(node => isForStatement(node) || isTryStatement(node)
            || isUnpackStatement(node) || isFunctionStatement(node))
            ? new Set<string>() : new Set(definition.parameters.filter(name => !nodes.some(node =>
                isAssignmentStatement(node) && node.name === name)));
        const argumentFor = (name: string): ValueFacts | undefined => {
            const index = definition.parameters.indexOf(name);
            const fact = index >= 0 && stableParameters.has(name) ? arguments_[index] : undefined;
            return fact?.types.includes('function') ? undefined : fact;
        };
        const cells = yields.map(statement => {
            const names = [statement.value, ...AstUtils.streamAllContents(statement.value)].filter(isNameExpression);
            return names.every(node => argumentFor(node.name))
                ? expressionFacts(statement.value, argumentFor) : UNKNOWN_VALUE;
        });
        if (definition.$container.$type === 'Program' && !nodes.some(isFunctionStatement)) {
            const positions = new Map(yields.map((statement, index) => [statement, index]));
            const locals = new Map<string, ValueFacts>();
            for (const statement of definition.statements) {
                if (isAssignmentStatement(statement) && statement.operator === '=' && !statement.name.includes('.')
                    && !definition.parameters.includes(statement.name)
                    && (isNameExpression(statement.value) || isNumberLiteral(statement.value)
                        || isStringLiteral(statement.value) || isBooleanLiteral(statement.value))) {
                    const lookup = (name: string) => locals.get(name) ?? argumentFor(name);
                    const facts = isNameExpression(statement.value) && !lookup(statement.value.name)
                        ? UNKNOWN_VALUE : expressionFacts(statement.value, lookup);
                    locals.set(statement.name, facts);
                } else if (isYieldStatement(statement)) {
                    const index = positions.get(statement);
                    if (index !== undefined) {
                        const names = [statement.value, ...AstUtils.streamAllContents(statement.value)].filter(isNameExpression);
                        if (names.every(node => locals.has(node.name) || argumentFor(node.name))) {
                            cells[index] = expressionFacts(statement.value,
                                name => locals.get(name) ?? argumentFor(name));
                        }
                    }
                } else {
                    // Branches and other statements can change a local before
                    // the next yield; do not carry its earlier fact across them.
                    locals.clear();
                }
            }
        }
        return { yields, cells };
    }

    function yieldTypes(cells: readonly ValueFacts[]): readonly string[] {
        return [...new Set(cells.flatMap(cell => cell.types))];
    }

    function call(name: string, arguments_: readonly ValueFacts[], caller: Map<string, ValueFacts>, site?: Expression): ValueFacts {
        const definition = functions.get(name);
        if (!definition || caller.get(name) !== functionBindings.get(name)
            || definition.parameters.length !== arguments_.length || activeCalls.has(name)
            || remainingCalls-- <= 0) return UNKNOWN_VALUE;
        const yields = functionYields(definition);
        if (yields.length) {
            // A generator call creates a sequence without executing its body.
            const { cells } = generatorCells(definition, arguments_);
            const known = yieldTypes(cells);
            const declarationKnown = yieldTypes(generatorCells(definition,
                definition.parameters.map(() => UNKNOWN_VALUE)).cells);
            if (site && known.length > 1 && declarationKnown.length <= 1) diagnostics.push({ node: site,
                kind: 'TypeError', message: `${name} yields incompatible types: ${known.join(' and ')}` });
            const elements = cells.length && cells.every(cell => cell.types.length) ? known : undefined;
            const scalars = cells.every(cell => cell.rank === 0);
            return { types: ['sequence'], ...(elements ? { elements } : {}),
                ...(scalars ? { rank: 1, shape: [cells.length ? null : 0] } : {}) };
        }
        const globalEnv = globalCallEnvs.at(-1) ?? caller;
        const local = new Map(definition.$container.$type === 'Program' ? globalEnv : caller);
        // Top-level functions create local bindings on assignment, rather than
        // inheriting the assignment contracts of equally named globals.
        for (const node of AstUtils.streamAllContents(definition)) {
            if (isAssignmentStatement(node) && !definition.parameters.includes(node.name)) local.delete(node.name);
        }
        definition.parameters.forEach((parameter, index) => local.set(parameter, {
            ...arguments_[index], acceptedArrayRank: arrayRank(arguments_[index]), acceptedTypes: arguments_[index].types,
        }));
        if (!definition.parameters.includes('index')) local.set('index', { types: ['index'], elements: [] });
        activeCalls.add(name);
        globalCallEnvs.push(globalEnv);
        privateParameters.push([...AstUtils.streamAllContents(definition)].some(isFunctionStatement)
            ? new Set() : new Set(definition.parameters));
        const diagnosticStart = diagnostics.length;
        try {
            const result = returnPaths(definition.statements, local);
            // Reaching the end throws: only paths that actually return contribute
            // a result value. With no proven return, the result remains unknown.
            return joinValueFacts(result.values);
        } finally {
            activeCalls.delete(name);
            globalCallEnvs.pop();
            privateParameters.pop();
            if (site) for (let index = diagnosticStart; index < diagnostics.length; index++) {
                diagnostics[index] = { ...diagnostics[index], node: site, message: `${name}: ${diagnostics[index].message}` };
            }
        }
    }

    interface ReturnPaths {
        values: ValueFacts[];
        fallsThrough: boolean;
        breaks: Map<string, ValueFacts>[];
        continues: Map<string, ValueFacts>[];
    }
    function returnPaths(items: readonly Statement[], env: Map<string, ValueFacts>): ReturnPaths {
        const values: ValueFacts[] = [];
        const breaks: Map<string, ValueFacts>[] = [];
        const continues: Map<string, ValueFacts>[] = [];
        for (const statement of items) {
            if (isBreakStatement(statement)) return { values, fallsThrough: false, breaks: [...breaks, env], continues };
            if (isContinueStatement(statement)) return { values, fallsThrough: false, breaks, continues: [...continues, env] };
            if (isReturnStatement(statement)) {
                const beforeEffects = statement.value && directCallBeforeEffects(statement.value, env);
                if (statement.value) invalidateCalls(statement.value, env);
                const observed = statement.value ? beforeEffects ?? inspect(statement.value, env) : UNKNOWN_VALUE;
                const contract = statement.value && isNameExpression(statement.value)
                    ? env.get(statement.value.name) : undefined;
                const result = observed.types.length || !contract?.acceptedTypes?.length ? observed
                    : { types: contract.acceptedTypes, acceptedArrayRank: contractRank(contract) };
                if (!statement.value || !directNoReturnCall(statement.value, env)) values.push(result);
                return { values, fallsThrough: false, breaks, continues };
            }
            if (isIfStatement(statement)) {
                const branches = conditionalPaths(statement, env);
                const survivors: Map<string, ValueFacts>[] = [];
                for (const branch of branches) {
                    const local = branch.env;
                    const diagnosticStart = diagnostics.length;
                    const result = returnPaths(branch.items, local);
                    // A call-site fact must not accuse an unproven branch of executing.
                    // Return facts still join all possible paths conservatively.
                    if (branches.length > 1) diagnostics.length = diagnosticStart;
                    values.push(...result.values);
                    breaks.push(...result.breaks);
                    continues.push(...result.continues);
                    if (result.fallsThrough) survivors.push(local);
                }
                if (!survivors.length) return { values, fallsThrough: false, breaks, continues };
                mergeEnvironments(env, survivors);
            } else if (isTryStatement(statement) && !statement.finallyStatements.length) {
                const success = new Map(env);
                const tried = returnPaths(statement.statements, success);
                values.push(...tried.values);
                breaks.push(...tried.breaks);
                continues.push(...tried.continues);
                const survivors = tried.fallsThrough ? [success] : [];
                for (const clause of statement.catches) {
                    // An error can occur after any prefix of the try body. Its
                    // bindings cannot be assumed to have their entry values.
                    const caught = new Map(env);
                    forgetNonFunctions(caught);
                    caught.set(clause.errorName, UNKNOWN_VALUE);
                    const start = diagnostics.length;
                    const path = returnPaths(clause.statements, caught);
                    diagnostics.length = start;
                    values.push(...path.values);
                    breaks.push(...path.breaks);
                    continues.push(...path.continues);
                    if (path.fallsThrough) survivors.push(caught);
                }
                if (!survivors.length) return { values, fallsThrough: false, breaks, continues };
                mergeEnvironments(env, survivors);
            } else if (isForStatement(statement)) {
                const contents = [...AstUtils.streamAllContents(statement)];
                if (contents.some(isReturnStatement)) values.push(...loopReturnPaths(statement, env));
                else loop(statement, env);
            } else if (isAssignmentStatement(statement) || isArrayAssignmentStatement(statement)
                || isIndexAssignmentStatement(statement)
                || isAddStatement(statement) || isPushStatement(statement)
                || isUnpackStatement(statement)
                || isExpressionStatement(statement) || isFunctionStatement(statement)) {
                if (!statements([statement], env)) return { values, fallsThrough: false, breaks, continues };
            } else {
                // Unknown control flow may return, yield, throw or alter captured state.
                return { values: [UNKNOWN_VALUE], fallsThrough: true, breaks, continues };
            }
        }
        return { values, fallsThrough: true, breaks, continues };
    }

    function emptyBuiltinRange(source: Expression | undefined, collection: ValueFacts): boolean {
        while (source && isParenthesizedExpression(source)) source = source.value;
        return !!source && isBinaryExpression(source)
            && (source.operator === 'to' || source.operator === 'until')
            && !inlineSliceOperands(source) && collection.types.join() === 'sequence'
            && collection.shape?.[0] === 0;
    }

    const writtenBindings = (node: AstNode): readonly string[] => isAssignmentStatement(node) ? [node.name]
        : isUnpackStatement(node) ? node.names.filter(name => name !== '#') : [];
    function widenArrayWrite(node: AstNode, env: Map<string, ValueFacts>): void {
        if (!isArrayAssignmentStatement(node)) return;
        const fact = env.get(node.name);
        if (fact) env.set(node.name, { ...fact, elements: undefined, positions: undefined, integers: undefined,
            eagerScalarCells: undefined, callbackFreeScalarCells: undefined });
    }
    function widenLoopExit(contents: readonly AstNode[], env: Map<string, ValueFacts>, preserved: ReadonlySet<string> = new Set()): void {
        for (const node of contents) {
            for (const name of writtenBindings(node)) {
                const fact = env.get(name);
                const rank = contractRank(fact);
                env.set(name, preserved.has(name) ? { ...fact, types: fact?.types ?? [],
                    shape: rank === undefined ? undefined : Array(rank).fill(null),
                    integers: undefined, positions: undefined }
                    : { types: fact?.acceptedTypes ?? [], acceptedTypes: fact?.acceptedTypes,
                        acceptedArrayRank: rank, ...(rank !== undefined ? { rank, shape: Array(rank).fill(null) } : {}) });
            }
            if (!isArrayAssignmentStatement(node) || !preserved.has(node.name)) widenArrayWrite(node, env);
        }
    }
    const directValue = (node: Expression): boolean => isNameExpression(node) || isNumberLiteral(node)
        || isStringLiteral(node) || isBooleanLiteral(node) || isLabelLiteral(node)
        || isParenthesizedExpression(node) && directValue(node.value);
    const safeRead = (fact: ValueFacts | undefined): boolean => fact?.eagerScalarCells === true
        || fact?.callbackFreeScalarCells === true || fact?.types.join() === 'text';
    const forgetNonFunctions = (env: Map<string, ValueFacts>): void => {
        for (const [name, fact] of env) if (!fact.types.includes('function')) env.set(name, invalidate(fact));
    };
    function loopBinding(condition: Expression | undefined): { names: readonly string[]; iterable: Expression } | undefined {
        if (!condition || !isBinaryExpression(condition) || condition.operator !== 'in') return undefined;
        const parts = flattenApplication(condition.left);
        if (parts.length < 1 || parts.length > 2 || !parts.every(part =>
            isNameExpression(part) || isAllAxisExpression(part))) return undefined;
        return { names: parts.map(part => isNameExpression(part) ? part.name : '#'), iterable: condition.right };
    }

    function safeIndexedIteration(collection: ValueFacts): boolean {
        const kind = collection.types.join();
        return kind === 'text' || kind === 'queue'
            || collection.rank !== undefined && collection.rank > 0 && ['array', 'sequence'].includes(kind)
                && (collection.eagerScalarCells === true || collection.callbackFreeScalarCells === true);
    }

    function safeIndexedSource(source: Expression): boolean {
        if (directValue(source)) return true;
        if (isBinaryExpression(source) && ['to', 'until'].includes(source.operator)) {
            return directValue(source.left) && directValue(source.right)
                && (!source.step || directValue(source.step));
        }
        if (!isApplicationExpression(source)) return false;
        const parts = flattenApplication(source);
        return parts.length === 3 && isNameExpression(parts[2]) && parts[2].name === 'window'
            && directValue(parts[0]) && directValue(parts[1]);
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
                        ? { rank: 0, shape: [] } : types.join() === 'text' ? { rank: 1, shape: [null] } : {}) });
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
            || safeIndexedIteration(collection) && safeIndexedSource(candidate.iterable)) ? candidate : undefined;
        const count = membership && collection.rank !== undefined && collection.rank > 0
            ? collection.shape?.[0] : undefined;
        if (count === 0) {
            if (!emptyBuiltinRange(source, collection)
                && !(source && safeIndexedIteration(collection) && safeIndexedSource(source))) {
                for (const [name, fact] of env) env.set(name, invalidate(fact));
            }
            return;
        }
        const contents = [...AstUtils.streamAllContents(statement)];
        const hasExit = contents.some(node => isBreakStatement(node) || isContinueStatement(node));
        if (condition && isBinaryExpression(condition) && condition.operator === 'in' && !membership
            || contents.some(node => isStatement(node) && !isExpression(node) && !isAssignmentStatement(node)
                && !isUnpackStatement(node) && !isArrayAssignmentStatement(node) && !isIndexAssignmentStatement(node)
                && !isAddStatement(node) && !isPushStatement(node) && !isExpressionStatement(node)
                && !isIfStatement(node) && !isForStatement(node)
                && !isBreakStatement(node) && !isContinueStatement(node))) {
            // Mutation and non-local exits need their own flow rules.
            for (const [name, fact] of env) env.set(name, invalidate(fact));
            return;
        }
        const writes = new Set(contents.filter(isArrayAssignmentStatement).map(node => node.name));
        const writesIndex = contents.some(isIndexAssignmentStatement);
        const indexBefore = env.get('index');
        const indexCandidate = writesIndex && indexBefore?.types.join() === 'index'
            && indexBefore.elements !== undefined ? indexBefore.elements : undefined;
        const rebound = new Set(contents.flatMap(writtenBindings));
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
                ? [[name, { ...fact, shape: Array(fact.rank).fill(null), elements: ['integer', 'real'] as Types,
                    eagerScalarCells: undefined, callbackFreeScalarCells: true as const,
                    integers: undefined, positions: undefined }] as const] : [];
        }));
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
                        ...(rank !== undefined ? { rank, shape: Array(rank).fill(null) } : {}) });
                }
                if (!isArrayAssignmentStatement(node) || !preserved.has(node.name)) widenArrayWrite(node, local);
            }
            if (writesIndex) {
                const index = local.get('index');
                if (index?.types.join() === 'index') local.set('index', { ...index, elements: indexSeed });
            }
            if (membership) bindIteration(local, membership.names, collection);
            return local;
        };
        const start = diagnostics.length;
        let preserved = new Set<string>();
        let local: Map<string, ValueFacts>;
        if (hasExit) {
            const body = prepare(preserved);
            const paths = returnPaths(statement.statements, body);
            if (count == null || count <= 0) diagnostics.length = start;
            const exits = [...paths.breaks, ...paths.continues, ...(paths.fallsThrough ? [body] : [])];
            for (const path of exits) widenLoopExit(contents, path);
            mergeEnvironments(env, [env, ...exits]);
            return;
        }
        const preview = prepare(new Set(candidates.keys()), indexCandidate, numeric);
        const effects = functionEffects(name => preview.get(name) === functionBindings.get(name)
            ? functions.get(name) : undefined, name => preview.get(name)?.types.includes('function') ?? false,
        name => preview.has(name));
        const safeCalls = contents.filter(isNameExpression).filter(node => preview.get(node.name)?.types.includes('function'))
            .every(node => {
                let site: AstNode = node;
                while (isApplicationExpression(site.$container)) site = site.$container;
                const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                if (parts.at(-1) !== node || parts.length - 1 !== functions.get(node.name)?.parameters.length
                    || !parts.slice(0, -1).every(directValue)) return false;
                const inputs = parts.slice(0, -1).map(part => expressionFacts(part, name => preview.get(name)));
                const effect = effects(node.name, inputs);
                return !effect.unknown && !effect.io && !effect.parameters.size && !effect.reboundParameters.size
                    && !effect.captures.size
                    && !effect.bindingCaptures.size && !effect.readCaptures.size && !effect.valueCaptures.size
                    && [...effect.readParameters].every(index => safeRead(inputs[index]));
            });
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
            let seed = indexCandidate;
            if (seed?.length === 0) {
                const first = prepare(new Set(candidates.keys()), seed, numeric);
                statements(statement.statements, first);
                seed = first.get('index')?.elements;
                restore();
            }
            const attempt = (arrays: ReadonlyMap<string, ValueFacts>) => {
                const trial = prepare(new Set(candidates.keys()), seed, numeric, arrays);
                statements(statement.statements, trial);
                const indexAfter = trial.get('index')?.elements;
                const closed = [...arrays].every(([name, fact]) => {
                    const after = trial.get(name);
                    return after?.types.join() === 'array' && after.rank === fact.rank && after.eagerScalarCells
                        && after.elements?.length === fact.elements!.length
                        && after.elements.every(type => fact.elements!.includes(type));
                }) && [...numeric].every(([name, fact]) => {
                    const after = trial.get(name);
                    return after?.types.join() === 'array' && after.rank === fact.rank
                        && (after.eagerScalarCells || after.callbackFreeScalarCells)
                        && after.elements?.length && after.elements.every(type => type === 'integer' || type === 'real');
                }) && (indexCandidate === undefined || seed !== undefined && indexAfter !== undefined
                    && indexAfter.every(type => seed.includes(type)));
                return { trial, closed };
            };
            let { trial, closed } = attempt(candidates);
            if (!closed && [...candidates.values()].some(fact => fact.elements?.every(type =>
                type === 'integer' || type === 'real'))) {
                restore();
                const widened = new Map([...candidates].map(([name, fact]) => [name,
                    fact.elements?.every(type => type === 'integer' || type === 'real')
                        ? { ...fact, elements: ['integer', 'real'] as Types } : fact] as const));
                ({ trial, closed } = attempt(widened));
            }
            if (closed) {
                local = trial;
                preserved = new Set([...candidates.keys(), ...numeric.keys()]);
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

    function loopReturnPaths(statement: ForStatement, env: Map<string, ValueFacts>): ValueFacts[] {
        const condition = statement.condition;
        if (condition && isBooleanLiteral(condition) && !condition.value) return [];
        const candidate = loopBinding(condition);
        const source = candidate?.iterable ?? condition;
        if (source) invalidateCalls(source, env);
        const collection = source ? inspect(source, env) : UNKNOWN_VALUE;
        const membership = candidate && (candidate.names.length === 1
            || safeIndexedIteration(collection) && safeIndexedSource(candidate.iterable)) ? candidate : undefined;
        const count = membership && collection.rank !== undefined && collection.rank > 0
            ? collection.shape?.[0] : undefined;
        if (count === 0) {
            if (!emptyBuiltinRange(source, collection)
                && !(source && safeIndexedIteration(collection) && safeIndexedSource(source))) {
                for (const [name, fact] of env) env.set(name, invalidate(fact));
            }
            return [];
        }
        const local = new Map(env);
        if ([...AstUtils.streamAllContents(statement)].some(isIndexAssignmentStatement)) {
            const index = local.get('index');
            if (index?.types.join() === 'index') local.set('index', { ...index, elements: undefined });
        }
        for (const node of AstUtils.streamAllContents(statement)) {
            for (const name of writtenBindings(node)) {
                const previous = local.get(name);
                const types = previous?.acceptedTypes ?? previous?.types ?? [];
                const rank = contractRank(previous);
                local.set(name, { types, acceptedTypes: types, acceptedArrayRank: rank,
                    ...(rank !== undefined ? { rank, shape: Array(rank).fill(null) } : {}) });
            }
            widenArrayWrite(node, local);
        }
        if (membership) bindIteration(local, membership.names, collection);
        const start = diagnostics.length;
        const returned = returnPaths(statement.statements, local);
        if (count == null || count <= 0) diagnostics.length = start;
        const exits = [...returned.breaks, ...returned.continues, ...(returned.fallsThrough ? [local] : [])];
        if (exits.length) {
            const contents = [...AstUtils.streamAllContents(statement)];
            for (const path of exits) widenLoopExit(contents, path);
            mergeEnvironments(env, [env, ...exits]);
        }
        return returned.values;
    }

    function invalidateCalls(expression: AstNode, env: Map<string, ValueFacts>): void {
        const syntax = new Set(['reduce', 'scan', 'outer', 'rank', 'axis', 'with', 'segment', 'from']);
        const effects = functionEffects(name => env.get(name) === functionBindings.get(name) ? functions.get(name) : undefined,
            name => env.get(name)?.types.includes('function') ?? false,
            name => env.has(name));
        const nodes = [expression, ...AstUtils.streamAllContents(expression)];
        const sliceModifiers = new Set(nodes.filter(isBinaryExpression)
            .flatMap(node => inlineSliceOperands(node)?.modifiers ?? []));
        let unknown = false;
        const written = new Set<string>();
        const writtenGlobals = new Set<string>();
        const rebound = new Set<string>();
        for (const node of nodes) {
            if (isStdinExpression(node)) unknown = true;
            if (!isNameExpression(node)) continue;
            if (sliceModifiers.has(node)) continue;
            if (env.get(node.name)?.types.includes('function')) {
                let site: AstNode = node;
                while (isApplicationExpression(site.$container)) site = site.$container;
                const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                const inputs = parts.at(-1) === node && parts.length - 1 === functions.get(node.name)?.parameters.length
                    ? parts.slice(0, -1).map(part => expressionFacts(part, name => env.get(name))) : undefined;
                const result = effects(node.name, inputs);
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
                }
                for (const capture of result.bindingCaptures) rebound.add(capture);
                for (const capture of result.readCaptures) {
                    const source = result.globalReadCaptures.has(capture)
                        ? globalCallEnvs.at(-1) ?? env : env;
                    unknown ||= !safeRead(source.get(capture));
                }
                if (result.parameters.size || result.readParameters.size) {
                    if (parts.at(-1) !== node || parts.length - 1 !== functions.get(node.name)?.parameters.length) unknown = true;
                    else {
                        for (const index of result.parameters) {
                            unknown ||= !array(expressionFacts(parts[index], name => env.get(name)));
                        }
                        for (const index of result.readParameters) {
                            unknown ||= !safeRead(expressionFacts(parts[index], name => env.get(name)));
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
                    if (parts.length === 2 && parts[1] === node && isLabelLiteral(parts[0])) continue;
                }
                const operation = findOperation(node.name);
                if (!operation || operation.effects?.length) unknown = true;
            }
        }
        if (!unknown && !written.size && !writtenGlobals.size && !rebound.size) return;
        // An unknown call can change captured bindings. Do not use a pre-call
        // shape, even in another operand of the same expression.
        if (unknown) {
            const protectedNames = privateParameters.at(-1);
            for (const [name, fact] of env) if (!fact.types.includes('function')) {
                const accepted = fact.acceptedTypes ?? fact.types;
                env.set(name, protectedNames?.has(name) && fact.rank === 0 && accepted.length > 0
                    && accepted.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))
                    ? { types: accepted, acceptedTypes: accepted, rank: 0, shape: [] } : invalidate(fact));
            }
            const global = globalCallEnvs.at(-1);
            if (global && global !== env) for (const [name, fact] of global) {
                if (!fact.types.includes('function')) global.set(name, invalidate(fact));
            }
            return;
        }
        // Parameter arrays have value semantics. A write to one parameter
        // cannot alter its caller's array, even if two arguments share storage.
        for (const [source, names] of [[env, written], [globalCallEnvs.at(-1) ?? env, writtenGlobals]] as const) {
            for (const name of names) {
                const fact = source.get(name);
                if (fact) source.set(name, { ...fact, elements: undefined, integers: undefined, positions: undefined,
                    eagerScalarCells: undefined, callbackFreeScalarCells: undefined });
            }
        }
        for (const name of rebound) {
            const fact = env.get(name);
            if (fact) env.set(name, invalidate(fact));
        }
    }

    function inspect(expression: Expression, env: Map<string, ValueFacts>): ValueFacts {
        const lookup: FactLookup = Object.assign((name: string) => env.get(name), {
            invoke: (name: string, arguments_: readonly ValueFacts[]) => call(name, arguments_, env, expression),
            arity: (name: string) => env.get(name) === functionBindings.get(name)
                ? functions.get(name)?.parameters.length : undefined,
        });
        if (isParenthesizedExpression(expression)) inspect(expression.value, env);
        if (isMaterializeExpression(expression)) inspect(expression.source, env);
        if (isUnaryExpression(expression)) inspect(expression.operand, env);
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
            for (const part of parts.slice(1)) inspect(part, env);
            const selectors = parts.slice(1);
            const last = parts.at(-1);
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
        return result;
    }

    // A direct call receives its already-evaluated arguments before its body
    // can invalidate caller facts. Limit this early snapshot to values whose
    // evaluation cannot itself call Rank or read host-owned array cells.
    function directCallBeforeEffects(value: Expression, env: Map<string, ValueFacts>): ValueFacts | undefined {
        if (!isApplicationExpression(value)) return undefined;
        const parts = flattenApplication(value);
        const target = parts.at(-1);
        if (!target || !isNameExpression(target) || env.get(target.name) !== functionBindings.get(target.name)
            || functions.get(target.name)?.parameters.length !== parts.length - 1) return undefined;
        const arguments_: ValueFacts[] = [];
        for (const part of parts.slice(0, -1)) {
            const atom = isParenthesizedExpression(part) ? part.value : part;
            if (!isNameExpression(atom) && !isNumberLiteral(atom) && !isStringLiteral(atom)
                && !isBooleanLiteral(atom)) return undefined;
            const fact = expressionFacts(atom, name => env.get(name));
            if (!fact.types.length || fact.types.includes('function')
                || fact.types.includes('array') && !fact.eagerScalarCells && !fact.callbackFreeScalarCells) return undefined;
            arguments_.push(fact);
        }
        return call(target.name, arguments_, new Map(env), value);
    }

    function statements(items: readonly Statement[], env: Map<string, ValueFacts>): boolean {
        for (const statement of items) {
            if (isAssignmentStatement(statement)) {
                const beforeEffects = statement.operator === '=' ? directCallBeforeEffects(statement.value, env) : undefined;
                invalidateCalls(statement.value, env);
                const previous = env.get(statement.name);
                let next = beforeEffects ?? inspect(statement.value, env);
                if (statement.operator !== '=') next = {
                    ...expressionFacts({ $type: 'BinaryExpression', operator: statement.operator.slice(0, -1),
                        left: { $type: 'NameExpression', name: statement.name }, right: statement.value } as Expression, name => env.get(name)),
                    types: compoundType(statement.operator, previous?.types ?? [], next.types),
                };
                const accepted = previous?.acceptedTypes ?? previous?.types;
                const expectedRank = contractRank(previous);
                const receivedRank = arrayRank(next);
                if (accepted?.length && next.types.length
                    && next.types.every(type => !accepted.includes(type))) {
                    diagnostics.push({ node: statement.value, kind: 'TypeError',
                        message: `${statement.name} has type ${accepted.join(' or ')} and cannot receive ${next.types.join(' or ')}` });
                } else if (expectedRank !== undefined && receivedRank !== undefined && expectedRank !== receivedRank) {
                    diagnostics.push({ node: statement.value, kind: 'DimensionMismatch',
                        message: `${statement.name} has rank ${expectedRank} and cannot receive rank ${receivedRank}` });
                }
                env.set(statement.name, { ...next, acceptedTypes: accepted ?? next.types,
                    acceptedArrayRank: expectedRank ?? receivedRank });
                if (directNoReturnCall(statement.value, env)) return false;
            } else if (isUnpackStatement(statement)) {
                invalidateCalls(statement.value, env);
                const source = inspect(statement.value, env);
                const knownCells = !!source.elements?.length;
                if (source.types.join() !== 'array' || source.rank !== 1
                    || source.shape?.[0] != null && source.shape[0] !== statement.names.length
                    || !knownCells && source.positions?.length !== statement.names.length
                    || !(source.eagerScalarCells || source.callbackFreeScalarCells)) {
                    for (const [name, fact] of env) if (!fact.types.includes('function')) env.set(name, invalidate(fact));
                    continue;
                }
                for (const [index, name] of statement.names.entries()) {
                    if (name === '#') continue;
                    const types = source.positions?.[index] ?? source.elements ?? [];
                    const previous = env.get(name);
                    const accepted = previous?.acceptedTypes ?? previous?.types;
                    if (accepted?.length && types.length && types.every(type => !accepted.includes(type))) {
                        diagnostics.push({ node: statement, kind: 'TypeError',
                            message: `${name} has type ${accepted.join(' or ')} and cannot receive ${types.join(' or ')}` });
                    }
                    const scalarCell = types.length && types.every(type =>
                        ['integer', 'real', 'boolean', 'symbol', 'date', 'datetime', 'duration'].includes(type));
                    const textCell = types.join() === 'text';
                    env.set(name, { types,
                        ...(scalarCell ? { rank: 0, shape: [] } : textCell ? { rank: 1, shape: [null] } : {}),
                        ...(source.integers?.[index] != null ? { integer: String(source.integers[index]) } : {}),
                        acceptedTypes: accepted ?? types });
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
                if (!directValue(statement.value) && !booleanValue) {
                    forgetNonFunctions(env);
                }
                const replacement = inspect(statement.value, env);
                const index = env.get('index');
                if (index?.types.join() === 'index' && index.elements !== undefined) {
                    env.set('index', { ...index,
                        elements: safeKeys && (directValue(statement.value) || booleanValue)
                            && replacement.types.length
                            ? [...new Set([...index.elements, ...replacement.types])] : undefined });
                }
            } else if (isPushStatement(statement)) {
                for (const value of [statement.receiver, statement.value]) {
                    invalidateCalls(value, env);
                    if (!directValue(value)) {
                        forgetNonFunctions(env);
                    }
                    inspect(value, env);
                }
            } else if (isArrayAssignmentStatement(statement)) {
                for (const index of statement.indices) if (index.value) {
                    invalidateCalls(index.value, env);
                    inspect(index.value, env);
                }
                invalidateCalls(statement.value, env);
                const replacement = inspect(statement.value, env);
                const fact = env.get(statement.name);
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
                const compound = statement.operator !== '=' && oneCellSelectors
                    && fact.eagerScalarCells === true
                    && !!fact.elements?.length && fact.elements.every(type => type === 'integer' || type === 'real')
                    && replacement.rank === 0 && replacement.types.length > 0
                    && replacement.types.every(type => type === 'integer' || type === 'real')
                    ? compoundType(statement.operator, fact.elements, replacement.types) : [];
                if ((isPlainArrayWrite(statement, integerSelector)
                    || statement.operator === '=' && oneCellSelectors || compound.length > 0)
                    && fact?.types.length
                    && fact.types.every(type => type === 'array')) {
                    // Keep old element types as conservative possibilities;
                    // a known scalar replacement adds its possible types.
                    const oneCell = oneCellSelectors && isAtom(replacement) && replacement.types.length > 0;
                    env.set(statement.name, { ...fact,
                        elements: oneCell && fact.elements?.length
                            ? [...new Set([...fact.elements, ...(compound.length ? compound : replacement.types)])] : undefined,
                        integers: undefined, positions: undefined,
                        callbackFreeScalarCells: undefined,
                        eagerScalarCells: oneCell && fact.eagerScalarCells
                            && replacement.types.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))
                            ? true : undefined });
                } else {
                    for (const [name, value] of env) if (!value.types.includes('function')) env.set(name, invalidate(value));
                }
            } else if (isExpressionStatement(statement)) {
                const parts = isApplicationExpression(statement.value)
                    ? flattenApplication(statement.value) : [];
                const key = parts[2] && expressionFacts(parts[2], name => env.get(name));
                const counterAdd = parts.length === 3 && isNameExpression(parts[0])
                    && env.get(parts[0].name)?.types.join() === 'counter'
                    && isNameExpression(parts[1]) && parts[1].name === 'add' && !env.has('add')
                    && directValue(parts[2]) && key && isAtom(key) && key.types.length > 0
                    && key.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol',
                        'date', 'datetime'].includes(type));
                if (!counterAdd) invalidateCalls(statement.value, env);
                inspect(statement.value, env);
                if (directNoReturnCall(statement.value, env)) return false;
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
                const paths = conditionalPaths(statement, env);
                const survivors: Map<string, ValueFacts>[] = [];
                for (const path of paths) {
                    const start = diagnostics.length;
                    if (statements(path.items, path.env)) survivors.push(path.env);
                    if (paths.length > 1) diagnostics.length = start;
                }
                if (!survivors.length) return false;
                // A later top-level statement need not execute when a branch
                // terminates, so do not diagnose from that branch's survivor alone.
                mergeEnvironments(env, paths.map(path => path.env));
            } else if (isForStatement(statement)) {
                loop(statement, env);
            } else {
                // Unsupported statements may mutate bindings through closures or imports.
                for (const [name, fact] of env) env.set(name, invalidate(fact));
            }
        }
        return true;
    }

    statements(program.statements, bindings);
    const functionResults = examples.map(example => call(example.name, example.arguments, bindings));
    const unique = diagnostics.filter((diagnostic, index) => !diagnostics.slice(0, index).some(previous =>
        previous.node === diagnostic.node && previous.message === diagnostic.message));
    return { diagnostics: unique, bindings, expressions, functions, functionResults };
}
