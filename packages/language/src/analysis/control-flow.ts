import {
    isAllAxisExpression, isBinaryExpression, isBooleanLiteral, isLabelLiteral, isNameExpression, isNumberLiteral,
    isParenthesizedExpression, isUnaryExpression, type Expression, type IfStatement, type Statement,
} from '../generated/ast.js';
import { expressionFacts } from './value-facts.js';
import { flattenApplication } from '../expressions.js';
import { joinValueFacts, UNKNOWN_VALUE, withPathDims, type ValueFacts } from './value-domain.js';
import type { Types } from './types.js';

export const arrayRank = (fact: ValueFacts | undefined): number | undefined =>
    fact?.types.length && fact.types.every(type => type === 'array' || type === 'bytes') ? fact.rank : undefined;
export const contractRank = (fact: ValueFacts | undefined): number | undefined => fact?.acceptedArrayRank ?? arrayRank(fact);
export const settledShape = (types: Types, rank: number | undefined): Pick<ValueFacts, 'rank' | 'shape'> =>
    rank !== undefined ? { rank, shape: Array(rank).fill(null) }
        : types.length && types.every(type => ['integer', 'real', 'boolean', 'symbol',
            'date', 'datetime', 'duration'].includes(type)) ? { rank: 0, shape: [] }
            : types.join() === 'text' ? { rank: 1, shape: [null] } : {};
export const invalidate = (fact: ValueFacts | undefined): ValueFacts => ({ types: [], acceptedArrayRank: contractRank(fact) });

export function loopBinding(condition: Expression | undefined): {
    names: readonly string[]; iterable: Expression;
} | undefined {
    if (!condition || !isBinaryExpression(condition) || condition.operator !== 'in') return undefined;
    const parts = flattenApplication(condition.left);
    if (parts.length < 1 || parts.length > 2 || !parts.every(part =>
        isNameExpression(part) || isAllAxisExpression(part))) return undefined;
    return { names: parts.map(part => isNameExpression(part) ? part.name : '#'), iterable: condition.right };
}

export function mergeEnvironments(env: Map<string, ValueFacts>, paths: readonly Map<string, ValueFacts>[]): void {
    const names = new Set(paths.flatMap(path => [...path.keys()]));
    for (const name of names) {
        const facts = paths.map(path => path.get(name) ?? UNKNOWN_VALUE);
        const first = facts[0];
        if (facts.every(fact => fact === first)) { env.set(name, first); continue; }
        const rank = contractRank(first);
        const accepted = facts.map(fact => ({ types: fact.acceptedTypes ?? fact.types }));
        env.set(name, { ...withPathDims(joinValueFacts(facts)), acceptedTypes: joinValueFacts(accepted).types,
            acceptedArrayRank: facts.every(fact => contractRank(fact) === rank) ? rank : undefined });
    }
}

function typeGuard(expression: Expression): { name: string; types: Types } | undefined {
    if (isParenthesizedExpression(expression)) return typeGuard(expression.value);
    if (!isBinaryExpression(expression)) return;
    if (expression.operator === 'is' && isNameExpression(expression.left) && isLabelLiteral(expression.right)) {
        return { name: expression.left.name, types: [expression.right.name] };
    }
    if (expression.operator === 'or') {
        const left = typeGuard(expression.left);
        const right = typeGuard(expression.right);
        if (left && right && left.name === right.name) return {
            name: left.name, types: [...new Set([...left.types, ...right.types])],
        };
    }
    return undefined;
}

function narrowGuard(fact: ValueFacts, types: Types): ValueFacts {
    if (types.join() === fact.types.join()) return { ...fact, acceptedTypes: types };
    const rank = types.length === 1 && (types[0] === 'array' || types[0] === 'bytes')
        ? contractRank(fact) : undefined;
    return { types, acceptedTypes: types, acceptedArrayRank: rank, ...settledShape(types, rank) };
}

function knownIntegerCondition(expression: Expression, env: ReadonlyMap<string, ValueFacts>): boolean | undefined {
    while (isParenthesizedExpression(expression)) expression = expression.value;
    if (!isBinaryExpression(expression)
        || !['equal', 'notequal', 'less', 'greater', 'atleast', 'atmost'].includes(expression.operator)) return;
    const integer = (part: Expression): bigint | undefined => {
        while (isParenthesizedExpression(part)) part = part.value;
        if (!isNameExpression(part) && !isNumberLiteral(part)
            && !(isUnaryExpression(part) && ['+', '-'].includes(part.operator)
                && isNumberLiteral(part.operand))) return;
        const value = expressionFacts(part, name => env.get(name)).integer;
        return value === undefined ? undefined : BigInt(value);
    };
    const left = integer(expression.left);
    const right = integer(expression.right);
    if (left === undefined || right === undefined) return;
    switch (expression.operator) {
        case 'equal': return left === right;
        case 'notequal': return left !== right;
        case 'less': return left < right;
        case 'greater': return left > right;
        case 'atleast': return left >= right;
        case 'atmost': return left <= right;
    }
    return undefined;
}

function knownBooleanCondition(expression: Expression, env: ReadonlyMap<string, ValueFacts>): boolean | undefined {
    while (isParenthesizedExpression(expression)) expression = expression.value;
    if (isBooleanLiteral(expression) || isNameExpression(expression)) {
        return expressionFacts(expression, name => env.get(name)).boolean;
    }
    if (isUnaryExpression(expression) && expression.operator === 'not') {
        const value = knownBooleanCondition(expression.operand, env);
        return value === undefined ? undefined : !value;
    }
    return undefined;
}

export function conditionalPaths(statement: IfStatement, env: Map<string, ValueFacts>,
    diagnostics: unknown[], inspect: (expression: Expression, env: Map<string, ValueFacts>) => unknown,
    invalidateCalls: (expression: Expression, env: Map<string, ValueFacts>) => void): { items: readonly Statement[]; env: Map<string, ValueFacts> }[] {
    const paths: { items: readonly Statement[]; env: Map<string, ValueFacts> }[] = [];
    const pending = new Map(env);
    for (const clause of [{ condition: statement.condition, statements: statement.thenStatements }, ...statement.elifClauses]) {
        invalidateCalls(clause.condition, pending);
        const start = diagnostics.length;
        inspect(clause.condition, pending);
        if (paths.length) diagnostics.length = start;
        const known = knownBooleanCondition(clause.condition, pending)
            ?? knownIntegerCondition(clause.condition, pending);
        if (known === false) continue;
        const guard = typeGuard(clause.condition);
        const fact = guard && pending.get(guard.name);
        const matching = fact && (fact.types.length
            ? fact.types.filter(type => guard!.types.includes(type)) : guard!.types);
        if (!fact || !guard || matching?.length) {
            const branch = new Map(pending);
            if (guard && fact && matching?.length) branch.set(guard.name, narrowGuard(fact, matching));
            paths.push({ items: clause.statements, env: branch });
        }
        if (guard && fact && fact.types.length) {
            const remaining = fact.types.filter(type => !guard.types.includes(type));
            if (!remaining.length) return paths;
            pending.set(guard.name, narrowGuard(fact, remaining));
        }
        if (known === true) return paths;
    }
    paths.push({ items: statement.elseStatements, env: pending });
    return paths;
}
