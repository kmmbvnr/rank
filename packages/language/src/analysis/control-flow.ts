import { recordBindingContract } from './return-contract.js';
import { arrayBindingContract, establishedArrayContract } from './array-binding-contract.js';
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
/** Contracts established when a function receives an argument. */
export const parameterFacts = (fact: ValueFacts): ValueFacts => ({ ...fact,
    acceptedArrayContract: establishedArrayContract(fact), acceptedArrayRank: arrayRank(fact), acceptedTypes: fact.types });
export const contractRank = (fact: ValueFacts | undefined): number | undefined => fact?.acceptedArrayRank ?? arrayRank(fact);
export const settledShape = (types: Types, rank: number | undefined): Pick<ValueFacts, 'rank' | 'shape'> =>
    rank !== undefined ? { rank, shape: Array(rank).fill(null) }
        : types.length && types.every(type => ['integer', 'real', 'boolean', 'symbol',
            'date', 'datetime', 'duration'].includes(type)) ? { rank: 0, shape: [] }
            : types.join() === 'text' ? { rank: 1, shape: [null] } : {};
export const invalidate = (fact: ValueFacts | undefined): ValueFacts => ({ types: [], acceptedRecordContract: recordBindingContract(fact), acceptedArrayRank: contractRank(fact), acceptedArrayContract: arrayBindingContract(fact) });

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
            acceptedRecordContract: facts.every(fact => recordBindingContract(fact))
                ? recordBindingContract(joinValueFacts(facts.map(fact => recordBindingContract(fact)!))) : undefined,
            acceptedArrayRank: facts.every(fact => contractRank(fact) === rank) ? rank : undefined,
            acceptedArrayContract: facts.every(fact => arrayBindingContract(fact))
                ? { type: 'array', rank, elements: facts.flatMap(fact => arrayBindingContract(fact)!.elements ?? []) } : undefined });
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
    return { types, acceptedTypes: types, acceptedArrayRank: rank, acceptedArrayContract: fact.acceptedArrayContract, ...settledShape(types, rank) };
}

type Bounds = [number, number];
type Relation = 'equal' | 'notequal' | 'less' | 'greater' | 'atleast' | 'atmost';
const RELATIONS: readonly string[] = ['equal', 'notequal', 'less', 'greater', 'atleast', 'atmost'];
const NEGATED: Record<Relation, Relation> = { equal: 'notequal', notequal: 'equal', less: 'atleast',
    atleast: 'less', greater: 'atmost', atmost: 'greater' };

const unwrap = (expression: Expression): Expression => {
    while (isParenthesizedExpression(expression)) expression = expression.value;
    return expression;
};

const integerScalar = (fact: ValueFacts | undefined): fact is ValueFacts =>
    !!fact && fact.types.join() === 'integer' && fact.rank === 0;

/** Bounds the integer operand has on this path: a literal, or a named integer scalar. Only exact proofs count. */
function boundsOf(part: Expression, env: ReadonlyMap<string, ValueFacts>): Bounds | undefined {
    part = unwrap(part);
    const literal = isNumberLiteral(part)
        || isUnaryExpression(part) && ['+', '-'].includes(part.operator) && isNumberLiteral(unwrap(part.operand));
    if (!literal && !isNameExpression(part)) return;
    const fact = isNameExpression(part) ? env.get(part.name) : expressionFacts(part, name => env.get(name));
    if (!integerScalar(fact)) return;
    if (fact.integer !== undefined) {
        const value = Number(fact.integer);
        return Number.isSafeInteger(value) ? [value, value] : undefined;
    }
    // A symbolic length is a natural number, so its constant part bounds it from below.
    return [Math.max(fact.interval?.[0] ?? -Infinity, fact.dim?.constant ?? -Infinity),
        fact.interval?.[1] ?? Infinity];
}

function decideRelation(operator: Relation, left: Bounds, right: Bounds): boolean | undefined {
    const [al, ah] = left;
    const [bl, bh] = right;
    switch (operator) {
        case 'less': return ah < bl ? true : al >= bh ? false : undefined;
        case 'greater': return al > bh ? true : ah <= bl ? false : undefined;
        case 'atleast': return al >= bh ? true : ah < bl ? false : undefined;
        case 'atmost': return ah <= bl ? true : al > bh ? false : undefined;
        case 'equal': return al === ah && bl === bh && al === bl ? true : ah < bl || al > bh ? false : undefined;
        case 'notequal': {
            const equal = decideRelation('equal', left, right);
            return equal === undefined ? undefined : !equal;
        }
    }
}

function comparison(expression: Expression): { operator: Relation; left: Expression; right: Expression } | undefined {
    expression = unwrap(expression);
    return isBinaryExpression(expression) && RELATIONS.includes(expression.operator)
        ? { operator: expression.operator as Relation, left: expression.left, right: expression.right } : undefined;
}

/** Whether a condition holds on every path or on none, from proven integer bounds only. */
function knownIntegerCondition(expression: Expression, env: ReadonlyMap<string, ValueFacts>): boolean | undefined {
    expression = unwrap(expression);
    if (isUnaryExpression(expression) && expression.operator === 'not') {
        const value = knownIntegerCondition(expression.operand, env);
        return value === undefined ? undefined : !value;
    }
    if (isBinaryExpression(expression) && ['and', 'or'].includes(expression.operator)) {
        const left = knownIntegerCondition(expression.left, env);
        const narrowed = new Map(env);
        assumeCondition(expression.left, expression.operator === 'and', narrowed);
        const right = knownIntegerCondition(expression.right, narrowed);
        return expression.operator === 'and'
            ? left === false || right === false ? false : left === true && right === true ? true : undefined
            : left === true || right === true ? true : left === false && right === false ? false : undefined;
    }
    const relation = comparison(expression);
    const left = relation && boundsOf(relation.left, env);
    const right = relation && boundsOf(relation.right, env);
    return relation && left && right ? decideRelation(relation.operator, left, right) : undefined;
}

function narrowName(side: Expression, env: Map<string, ValueFacts>, bounds: Bounds): void {
    side = unwrap(side);
    const fact = isNameExpression(side) ? env.get(side.name) : undefined;
    if (!isNameExpression(side) || !integerScalar(fact) || fact.integer !== undefined) return;
    const [low, high] = boundsOf(side, env) ?? [-Infinity, Infinity];
    const next: Bounds = [Math.max(low, bounds[0]), Math.min(high, bounds[1])];
    env.set(side.name, { ...fact, interval: [Number.isFinite(next[0]) ? next[0] : null,
        Number.isFinite(next[1]) ? next[1] : null] });
}

/** Records on `env` what a condition proves when it is (or is not) true. Unprovable parts add nothing. */
function assumeCondition(expression: Expression, truthy: boolean, env: Map<string, ValueFacts>): void {
    expression = unwrap(expression);
    if (isUnaryExpression(expression) && expression.operator === 'not') {
        assumeCondition(expression.operand, !truthy, env);
        return;
    }
    if (isBinaryExpression(expression) && (expression.operator === 'and' && truthy
        || expression.operator === 'or' && !truthy)) {
        assumeCondition(expression.left, truthy, env);
        assumeCondition(expression.right, truthy, env);
        return;
    }
    const relation = comparison(expression);
    if (!relation) return;
    const operator = truthy ? relation.operator : NEGATED[relation.operator];
    const left = boundsOf(relation.left, env);
    const right = boundsOf(relation.right, env);
    if (!left || !right) return;
    // Orient every ordering as `small <= large - gap`, then narrow each side by the other.
    const ordered = operator === 'less' ? [relation.left, relation.right, left, right, 1] as const
        : operator === 'atmost' ? [relation.left, relation.right, left, right, 0] as const
            : operator === 'greater' ? [relation.right, relation.left, right, left, 1] as const
                : operator === 'atleast' ? [relation.right, relation.left, right, left, 0] as const : undefined;
    if (ordered) {
        const [small, large, smallBounds, largeBounds, gap] = ordered;
        narrowName(small, env, [-Infinity, largeBounds[1] - gap]);
        narrowName(large, env, [smallBounds[0] + gap, Infinity]);
    } else if (operator === 'equal') {
        narrowName(relation.left, env, right);
        narrowName(relation.right, env, left);
    }
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
            assumeCondition(clause.condition, true, branch);
            if (guard && fact && matching?.length) branch.set(guard.name, narrowGuard(fact, matching));
            paths.push({ items: clause.statements, env: branch });
        }
        if (guard && fact && fact.types.length) {
            const remaining = fact.types.filter(type => !guard.types.includes(type));
            if (!remaining.length) return paths;
            pending.set(guard.name, narrowGuard(fact, remaining));
        }
        if (known === true) return paths;
        assumeCondition(clause.condition, false, pending);
    }
    paths.push({ items: statement.elseStatements, env: pending });
    return paths;
}
