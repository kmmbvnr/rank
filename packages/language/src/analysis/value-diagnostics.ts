import { AstUtils, type AstNode } from 'langium';
import {
    isApplicationExpression, isAllAxisExpression, isNameExpression, isNumberLiteral, isStringLiteral, isParenthesizedExpression,
    isArrayExpression, isMaterializeExpression, isUnaryExpression, isBooleanLiteral,
    isArrayAssignmentStatement, isAssignmentStatement, isBinaryExpression, isExpressionStatement, isStatement, isExpression,
    isForStatement, isFunctionStatement, isIfStatement, isReturnStatement, isStdinExpression,
    isTryStatement, isUnpackStatement, isYieldStatement,
    type Expression, type Program, type Statement, type FunctionStatement, type IfStatement, type ForStatement,
    type YieldStatement,
} from '../generated/ast.js';
import { compoundType } from './types.js';
import { flattenApplication } from '../expressions.js';
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
        activeCalls.add(name);
        globalCallEnvs.push(globalEnv);
        const diagnosticStart = diagnostics.length;
        try {
            const result = returnPaths(definition.statements, local);
            // Reaching the end throws: only paths that actually return contribute
            // a result value. With no proven return, the result remains unknown.
            return joinValueFacts(result.values);
        } finally {
            activeCalls.delete(name);
            globalCallEnvs.pop();
            if (site) for (let index = diagnosticStart; index < diagnostics.length; index++) {
                diagnostics[index] = { ...diagnostics[index], node: site, message: `${name}: ${diagnostics[index].message}` };
            }
        }
    }

    function returnPaths(items: readonly Statement[], env: Map<string, ValueFacts>): { values: ValueFacts[]; fallsThrough: boolean } {
        const values: ValueFacts[] = [];
        for (const statement of items) {
            if (isReturnStatement(statement)) {
                if (statement.value) invalidateCalls(statement.value, env);
                const result = statement.value ? inspect(statement.value, env) : UNKNOWN_VALUE;
                if (!statement.value || !directNoReturnCall(statement.value, env)) values.push(result);
                return { values, fallsThrough: false };
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
                    if (result.fallsThrough) survivors.push(local);
                }
                if (!survivors.length) return { values, fallsThrough: false };
                mergeEnvironments(env, survivors);
            } else if (isForStatement(statement)) {
                // A return/break/continue inside a loop needs a separate exit analysis.
                if ([...AstUtils.streamAllContents(statement)].some(node =>
                    isReturnStatement(node) || node.$type === 'BreakStatement' || node.$type === 'ContinueStatement')) {
                    return { values: [UNKNOWN_VALUE], fallsThrough: true };
                }
                loop(statement, env);
            } else if (isAssignmentStatement(statement) || isArrayAssignmentStatement(statement)
                || isExpressionStatement(statement) || isFunctionStatement(statement)) {
                if (!statements([statement], env)) return { values, fallsThrough: false };
            } else {
                // Unknown control flow may return, yield, throw or alter captured state.
                return { values: [UNKNOWN_VALUE], fallsThrough: true };
            }
        }
        return { values, fallsThrough: true };
    }

    function loop(statement: ForStatement, env: Map<string, ValueFacts>): void {
        const condition = statement.condition;
        if (condition && isBooleanLiteral(condition) && !condition.value) return;
        const membership = condition && isBinaryExpression(condition) && condition.operator === 'in'
            && isNameExpression(condition.left) ? condition : undefined;
        const source = membership ? membership.right : condition;
        if (source) invalidateCalls(source, env);
        const collection = source ? inspect(source, env) : UNKNOWN_VALUE;
        const count = membership && collection.rank === 1 ? collection.shape?.[0] : undefined;
        if (count === 0) return;
        const contents = [...AstUtils.streamAllContents(statement)];
        if (condition && isBinaryExpression(condition) && condition.operator === 'in' && !membership
            || contents.some(node => isStatement(node) && !isExpression(node) && !isAssignmentStatement(node)
                && !isExpressionStatement(node) && !isIfStatement(node) && !isForStatement(node))) {
            // Destructuring, mutation and non-local exits need their own flow rules.
            for (const [name, fact] of env) env.set(name, invalidate(fact));
            return;
        }
        const local = new Map(env);
        // Widen before examining the body: later iterations may have different
        // lengths and elements. Only an existing binding contract is invariant.
        for (const node of contents) {
            if (isAssignmentStatement(node)) {
                const previous = local.get(node.name);
                const types = previous?.acceptedTypes ?? previous?.types ?? [];
                const rank = contractRank(previous);
                local.set(node.name, { types, acceptedTypes: types, acceptedArrayRank: rank,
                    ...(rank !== undefined ? { rank, shape: Array(rank).fill(null) } : {}) });
            }
        }
        if (membership && isNameExpression(membership.left)) {
            const types = collection.elements ?? [];
            local.set(membership.left.name, { types, acceptedTypes: types,
                ...(types.length && types.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))
                    ? { rank: 0, shape: [] } : {}) });
        }
        const start = diagnostics.length;
        statements(statement.statements, local);
        if (count == null || count <= 0) diagnostics.length = start;
        // No final-iteration dimensions are proven. Keep contracts, not body values.
        for (const node of contents) {
            if (isAssignmentStatement(node)) {
                const fact = local.get(node.name);
                const rank = contractRank(fact);
                local.set(node.name, { types: fact?.acceptedTypes ?? [], acceptedTypes: fact?.acceptedTypes,
                    acceptedArrayRank: rank, ...(rank !== undefined ? { rank, shape: Array(rank).fill(null) } : {}) });
            }
        }
        mergeEnvironments(env, [env, local]);
    }

    function invalidateCalls(expression: AstNode, env: Map<string, ValueFacts>): void {
        const syntax = new Set(['reduce', 'scan', 'outer', 'rank', 'axis', 'with', 'segment']);
        const effects = functionEffects(name => env.get(name) === functionBindings.get(name) ? functions.get(name) : undefined,
            name => env.get(name)?.types.includes('function') ?? false,
            name => env.has(name));
        const nodes = [expression, ...AstUtils.streamAllContents(expression)];
        let unknown = false;
        const written = new Set<string>();
        const writtenGlobals = new Set<string>();
        const rebound = new Set<string>();
        for (const node of nodes) {
            if (isStdinExpression(node)) unknown = true;
            if (!isNameExpression(node)) continue;
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
                const safeRead = (fact: ValueFacts | undefined) => fact?.eagerScalarCells === true
                    || fact?.types.join() === 'text';
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
                const operation = findOperation(node.name);
                if (!operation || operation.effects?.length) unknown = true;
            }
        }
        if (!unknown && !written.size && !writtenGlobals.size && !rebound.size) return;
        // An unknown call can change captured bindings. Do not use a pre-call
        // shape, even in another operand of the same expression.
        if (unknown) {
            for (const [name, fact] of env) if (!fact.types.includes('function')) env.set(name, invalidate(fact));
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
                if (fact) source.set(name, { ...fact, elements: undefined, integers: undefined, eagerScalarCells: undefined });
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
        if (globalCallEnvs.length || !isApplicationExpression(value)) return undefined;
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
                || fact.types.includes('array') && !fact.eagerScalarCells) return undefined;
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
            } else if (isArrayAssignmentStatement(statement)) {
                for (const index of statement.indices) if (index.value) {
                    invalidateCalls(index.value, env);
                    inspect(index.value, env);
                }
                invalidateCalls(statement.value, env);
                const replacement = inspect(statement.value, env);
                const fact = env.get(statement.name);
                if (isPlainArrayWrite(statement, value => expressionFacts(value, name => env.get(name)).types.join() === 'integer')
                    && fact?.types.length
                    && fact.types.every(type => type === 'array')) {
                    // Keep old element types as conservative possibilities;
                    // a known scalar replacement adds its possible types.
                    const oneCell = statement.indices.length === 1 && !statement.indices[0].all
                        && fact.rank === 1 && isAtom(replacement) && replacement.types.length > 0;
                    env.set(statement.name, { ...fact,
                        elements: oneCell && fact.elements?.length
                            ? [...new Set([...fact.elements, ...replacement.types])] : undefined,
                        integers: undefined,
                        eagerScalarCells: oneCell && fact.eagerScalarCells
                            && replacement.types.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))
                            ? true : undefined });
                } else {
                    for (const [name, value] of env) if (!value.types.includes('function')) env.set(name, invalidate(value));
                }
            } else if (isExpressionStatement(statement)) {
                invalidateCalls(statement.value, env);
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
