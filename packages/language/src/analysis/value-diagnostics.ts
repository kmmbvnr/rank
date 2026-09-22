import { AstUtils, type AstNode } from 'langium';
import {
    isApplicationExpression, isAllAxisExpression, isNameExpression, isParenthesizedExpression,
    isArrayExpression, isMaterializeExpression, isUnaryExpression, isBooleanLiteral,
    isNumberLiteral, isStringLiteral, isLabelLiteral, isTextBlockExpression,
    isAssignmentStatement, isBinaryExpression, isExpressionStatement,
    isForStatement, isFunctionStatement, isIfStatement, isReturnStatement,
    type Expression, type Program, type Statement, type FunctionStatement,
} from '../generated/ast.js';
import { compoundType } from './types.js';
import { flattenApplication } from '../expressions.js';
import { findOperation } from '../operations.js';
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
                invalidateCalls(statement.condition, env);
                inspect(statement.condition, env);
                for (const clause of statement.elifClauses) invalidateCalls(clause.condition, env);
                const alternatives = [...statement.elifClauses.map(clause => clause.statements), statement.elseStatements];
                const branches = isBooleanLiteral(statement.condition)
                    ? statement.condition.value ? [statement.thenStatements] : alternatives
                    : [statement.thenStatements, ...alternatives];
                const survivors: Map<string, ValueFacts>[] = [];
                for (const branch of branches) {
                    const local = new Map(env);
                    const diagnosticStart = diagnostics.length;
                    const result = returnPaths(branch, local);
                    // A call-site fact must not accuse an unproven branch of executing.
                    // Return facts still join all possible paths conservatively.
                    if (branches.length > 1) diagnostics.length = diagnosticStart;
                    values.push(...result.values);
                    if (result.fallsThrough) survivors.push(local);
                }
                if (!survivors.length) return { values, fallsThrough: false };
                for (const name of env.keys()) env.set(name, joinValueFacts(survivors.map(local => local.get(name) ?? UNKNOWN_VALUE)));
            } else if (isAssignmentStatement(statement) || isExpressionStatement(statement)) {
                statements([statement], env);
            } else {
                // Unknown control flow may return, yield, throw or alter captured state.
                return { values: [UNKNOWN_VALUE], fallsThrough: true };
            }
        }
        return { values, fallsThrough: true };
    }

    function invalidateCalls(expression: AstNode, env: Map<string, ValueFacts>): void {
        const syntax = new Set(['reduce', 'scan', 'outer', 'rank', 'axis', 'with', 'segment']);
        const checking = new Set<string>();
        const checked = new Map<string, boolean>();
        const readOnly = (name: string): boolean => {
            if (checked.has(name)) return checked.get(name)!;
            const definition = functions.get(name);
            if (!definition || env.get(name) !== functionBindings.get(name)
                || checking.has(name)) return false;
            const contents = [...AstUtils.streamAllContents(definition)];
            if (!contents.some(isReturnStatement)) return false;
            const locals = new Set([...definition.parameters,
                ...contents.filter(isAssignmentStatement).map(node => node.name)]);
            const safeExpression = (value: Expression): boolean => {
                if (isNameExpression(value)) return locals.has(value.name)
                    || /^[A-Z]/.test(value.name) && !env.get(value.name)?.types.includes('function');
                if (isApplicationExpression(value)) {
                    const parts = flattenApplication(value);
                    const target = parts.at(-1)!;
                    return isNameExpression(target) && !locals.has(target.name) && readOnly(target.name)
                        && parts.slice(0, -1).every(safeExpression);
                }
                if (isNumberLiteral(value) || isStringLiteral(value) || isBooleanLiteral(value)
                    || isLabelLiteral(value) || isTextBlockExpression(value)) return true;
                if (isParenthesizedExpression(value)) return safeExpression(value.value);
                if (isUnaryExpression(value)) return safeExpression(value.operand);
                if (isBinaryExpression(value)) return safeExpression(value.left) && safeExpression(value.right)
                    && (!value.step || safeExpression(value.step));
                if (isArrayExpression(value)) return [...value.items, ...value.dimensions, ...value.rows.flatMap(row => row.items)]
                    .every(item => safeExpression(item.value)) && (!value.fill || safeExpression(value.fill));
                // In particular, table writes, stdin and lazy materialization
                // must not be classified as safe just because their children are.
                return false;
            };
            const safeStatement = (statement: Statement): boolean => {
                // Compound assignment can resolve to a captured binding.
                if (isAssignmentStatement(statement)) return statement.operator === '=' && safeExpression(statement.value);
                if (isExpressionStatement(statement)) return safeExpression(statement.value);
                if (isReturnStatement(statement)) return !statement.value || safeExpression(statement.value);
                if (isIfStatement(statement)) return safeExpression(statement.condition)
                    && statement.thenStatements.every(safeStatement)
                    && statement.elifClauses.every(clause => safeExpression(clause.condition) && clause.statements.every(safeStatement))
                    && statement.elseStatements.every(safeStatement);
                return false;
            };
            checking.add(name);
            try {
                const result = definition.statements.every(safeStatement);
                checked.set(name, result);
                return result;
            }
            finally { checking.delete(name); }
        };
        const nodes = [expression, ...AstUtils.streamAllContents(expression)];
        if (!nodes.some(node => isNameExpression(node) && (
            env.get(node.name)?.types.includes('function') && !readOnly(node.name)
            || /^[a-z]/.test(node.name) && !env.has(node.name) && !syntax.has(node.name)
                && !findOperation(node.name)))) return;
        // An unknown call can change captured bindings. Do not use a pre-call
        // shape, even in another operand of the same expression.
        for (const [name, fact] of env) if (!fact.types.includes('function')) env.set(name, invalidate(fact));
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
            } else if (isExpressionStatement(statement)) {
                invalidateCalls(statement.value, env);
                inspect(statement.value, env);
            } else if (isFunctionStatement(statement)) {
                const fact = { types: ['function'] };
                env.set(statement.name, fact);
                functionBindings.set(statement.name, fact);
                functions.set(statement.name, statement);
            } else if (isIfStatement(statement) || isForStatement(statement)) {
                invalidateCalls(statement, env);
                if (statement.condition) {
                    invalidateCalls(statement.condition, env);
                    inspect(statement.condition, env);
                }
                // Do not retain pre-loop lengths after a possible write. In particular,
                // the first iteration is not evidence about later iterations.
                for (const node of AstUtils.streamAllContents(statement)) {
                    if (isAssignmentStatement(node)) env.set(node.name, invalidate(env.get(node.name)));
                }
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
