import { AstUtils, type AstNode } from 'langium';
import {
    isApplicationExpression, isAllAxisExpression, isNameExpression, isParenthesizedExpression,
    isArrayExpression, isMaterializeExpression, isUnaryExpression, isBooleanLiteral,
    isArrayAssignmentStatement, isAssignmentStatement, isBinaryExpression, isExpressionStatement, isStatement, isExpression,
    isForStatement, isFunctionStatement, isIfStatement, isReturnStatement,
    type Expression, type Program, type Statement, type FunctionStatement, type IfStatement, type ForStatement,
} from '../generated/ast.js';
import { compoundType } from './types.js';
import { flattenApplication } from '../expressions.js';
import { findOperation } from '../operations.js';
import { functionEffects, isPlainArrayWrite } from './function-effects.js';
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
    let remainingCalls = 100;

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

    function call(name: string, arguments_: readonly ValueFacts[], caller: Map<string, ValueFacts>, site?: Expression): ValueFacts {
        const definition = functions.get(name);
        if (!definition || caller.get(name) !== functionBindings.get(name)
            || definition.parameters.length !== arguments_.length || activeCalls.has(name)
            || remainingCalls-- <= 0) return UNKNOWN_VALUE;
        const local = new Map(caller);
        // Top-level functions create local bindings on assignment, rather than
        // inheriting the assignment contracts of equally named globals.
        for (const node of AstUtils.streamAllContents(definition)) {
            if (isAssignmentStatement(node) && !definition.parameters.includes(node.name)) local.delete(node.name);
        }
        definition.parameters.forEach((parameter, index) => local.set(parameter, {
            ...arguments_[index], acceptedArrayRank: arrayRank(arguments_[index]), acceptedTypes: arguments_[index].types,
        }));
        activeCalls.add(name);
        const diagnosticStart = diagnostics.length;
        try {
            const result = returnPaths(definition.statements, local);
            return joinValueFacts([...result.values, ...(result.fallsThrough ? [UNKNOWN_VALUE] : [])]);
        } finally {
            activeCalls.delete(name);
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
                values.push(statement.value ? inspect(statement.value, env) : UNKNOWN_VALUE);
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
                || isExpressionStatement(statement)) {
                statements([statement], env);
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
        invalidateCalls(statement, local);
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
            name => env.get(name)?.types.includes('function') ?? false);
        const nodes = [expression, ...AstUtils.streamAllContents(expression)];
        let unknown = false;
        const written = new Set<string>();
        for (const node of nodes) {
            if (!isNameExpression(node)) continue;
            if (env.get(node.name)?.types.includes('function')) {
                const result = effects(node.name);
                unknown ||= result.unknown;
                // Other indexed structures can invoke user callbacks on writes.
                const array = (fact: ValueFacts | undefined) => !!fact?.types.length
                    && fact.types.every(type => type === 'array');
                for (const capture of result.captures) {
                    unknown ||= !array(env.get(capture));
                    written.add(capture);
                }
                for (const capture of result.readCaptures) {
                    unknown ||= !env.get(capture)?.eagerScalarCells;
                }
                if (result.parameters.size || result.readParameters.size) {
                    let site: AstNode = node;
                    while (isApplicationExpression(site.$container)) site = site.$container;
                    const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                    if (parts.at(-1) !== node || parts.length - 1 !== functions.get(node.name)?.parameters.length) unknown = true;
                    else {
                        for (const index of result.parameters) {
                            unknown ||= !array(expressionFacts(parts[index], name => env.get(name)));
                        }
                        for (const index of result.readParameters) {
                            unknown ||= !expressionFacts(parts[index], name => env.get(name)).eagerScalarCells;
                        }
                    }
                }
            } else if (/^[a-z]/.test(node.name) && !env.has(node.name) && !syntax.has(node.name)
                && !findOperation(node.name)) unknown = true;
        }
        if (!unknown && !written.size) return;
        // An unknown call can change captured bindings. Do not use a pre-call
        // shape, even in another operand of the same expression.
        if (unknown) {
            for (const [name, fact] of env) if (!fact.types.includes('function')) env.set(name, invalidate(fact));
            return;
        }
        // Parameter arrays have value semantics. A write to one parameter
        // cannot alter its caller's array, even if two arguments share storage.
        for (const name of written) {
            const fact = env.get(name);
            if (fact) env.set(name, { ...fact, elements: undefined, integers: undefined, eagerScalarCells: undefined });
        }
    }

    function inspect(expression: Expression, env: Map<string, ValueFacts>): ValueFacts {
        const lookup: FactLookup = Object.assign((name: string) => env.get(name), {
            call: (name: string, arguments_: readonly ValueFacts[]) => call(name, arguments_, env, expression),
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

    function statements(items: readonly Statement[], env: Map<string, ValueFacts>): void {
        for (const statement of items) {
            if (isAssignmentStatement(statement)) {
                invalidateCalls(statement.value, env);
                const previous = env.get(statement.name);
                let next = inspect(statement.value, env);
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
            } else if (isFunctionStatement(statement)) {
                const fact = { types: ['function'] };
                env.set(statement.name, fact);
                functionBindings.set(statement.name, fact);
                functions.set(statement.name, statement);
            } else if (isIfStatement(statement)) {
                const paths = conditionalPaths(statement, env);
                for (const path of paths) {
                    const start = diagnostics.length;
                    statements(path.items, path.env);
                    if (paths.length > 1) diagnostics.length = start;
                }
                mergeEnvironments(env, paths.map(path => path.env));
            } else if (isForStatement(statement)) {
                loop(statement, env);
            } else {
                // Unsupported statements may mutate bindings through closures or imports.
                for (const [name, fact] of env) env.set(name, invalidate(fact));
            }
        }
    }

    statements(program.statements, bindings);
    const functionResults = examples.map(example => call(example.name, example.arguments, bindings));
    const unique = diagnostics.filter((diagnostic, index) => !diagnostics.slice(0, index).some(previous =>
        previous.node === diagnostic.node && previous.message === diagnostic.message));
    return { diagnostics: unique, bindings, expressions, functions, functionResults };
}
