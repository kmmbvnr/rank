import {
    isApplicationExpression, isAssignmentStatement, isBinaryExpression, isBooleanLiteral, isForStatement, isIfStatement,
    isNameExpression, isNumberLiteral, isParenthesizedExpression,
    isUnaryExpression,
    isReturnStatement, type Expression, type FunctionStatement,
} from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';

type GuardType = 'bigint' | 'boolean' | 'flat-array';
type Guards = Map<number, GuardType>;
const integerTypes = (indices: ReadonlySet<number>): Guards => new Map([...indices].map(index => [index, 'bigint']));
function mergeGuards(into: Guards, next: ReadonlyMap<number, GuardType>): boolean {
    for (const [index, type] of next) {
        const previous = into.get(index);
        if (previous && previous !== type) return false;
        into.set(index, type);
    }
    return true;
}

/** Possible flat-array borrows. The caller must check argument kind and callable identity. */
export function flatArrayBorrowCandidates(definition: FunctionStatement,
    resolve: (name: string) => FunctionStatement | undefined): ReadonlySet<number> {
    return new Set([...flatArrayBorrowProofs(definition, resolve)]
        .filter(([, guards]) => guards.size === 0).map(([index]) => index));
}

/** Candidate guards are checked against actual argument types at the call boundary. */
export function flatArrayBorrowProofs(definition: FunctionStatement,
    resolve: (name: string) => FunctionStatement | undefined,
    builtin: (name: 'len' | 'min' | 'max') => boolean = () => false,
): ReadonlyMap<number, ReadonlyMap<number, GuardType>> {
    const cache = new WeakMap<FunctionStatement, ReadonlyMap<number, Guards>>();
    const active = new WeakSet<FunctionStatement>();
    let budget = 100;
    const directName = (value: Expression | undefined, parameter: string): boolean => {
        while (value && isParenthesizedExpression(value)) value = value.value;
        return !!value && isNameExpression(value) && value.name === parameter;
    };
    const integerGuards = (value: Expression, current: FunctionStatement, arrayParameter: string,
        selectorLocals: ReadonlyMap<string, ReadonlySet<number>>): Set<number> | undefined => {
        if (isParenthesizedExpression(value)) return integerGuards(value.value, current, arrayParameter, selectorLocals);
        if (isNumberLiteral(value)) return typeof value.value === 'bigint' ? new Set() : undefined;
        if (isNameExpression(value)) {
            const index = current.parameters.indexOf(value.name);
            return index >= 0 && value.name !== arrayParameter ? new Set([index])
                : selectorLocals.has(value.name) ? new Set(selectorLocals.get(value.name)) : undefined;
        }
        if (isApplicationExpression(value)) {
            const parts = flattenApplication(value);
            if (parts.length === 2 && directName(parts[0], arrayParameter)
                && isNameExpression(parts[1]) && parts[1].name === 'len'
                && !current.parameters.includes('len') && builtin('len')) return new Set();
        }
        if (isUnaryExpression(value) && (value.operator === '+' || value.operator === '-')) {
            return integerGuards(value.operand, current, arrayParameter, selectorLocals);
        }
        if (isBinaryExpression(value) && !value.step && ['+', '-', '*', '//', '%'].includes(value.operator)) {
            const left = integerGuards(value.left, current, arrayParameter, selectorLocals);
            const right = integerGuards(value.right, current, arrayParameter, selectorLocals);
            return left && right ? new Set([...left, ...right]) : undefined;
        }
        return undefined;
    };
    const inspect = (current: FunctionStatement): ReadonlyMap<number, Guards> => {
        const cached = cache.get(current);
        if (cached) return cached;
        if (active.has(current) || budget-- <= 0) return new Map();
        if (new Set(current.parameters).size !== current.parameters.length) return new Map();
        active.add(current);
        try {
            const onlyReads = (node: unknown, parameter: string,
                selectorLocals: Map<string, ReadonlySet<number>>, scalarLocals: Set<string>,
                allowAssignment: boolean): Guards | undefined => {
                if (!node || typeof node !== 'object') return new Map();
                if (Array.isArray(node)) {
                    const guards: Guards = new Map();
                    for (const child of node) {
                        const next = onlyReads(child, parameter, selectorLocals, scalarLocals, allowAssignment);
                        if (!next || !mergeGuards(guards, next)) return undefined;
                    }
                    return guards;
                }
                const item = node as Record<string, unknown>;
                const booleanGuards = (value: Expression): Guards | undefined => {
                    if (isParenthesizedExpression(value)) return booleanGuards(value.value);
                    if (isBooleanLiteral(value)) return new Map();
                    if (!isNameExpression(value) || value.name === parameter) return undefined;
                    const index = current.parameters.indexOf(value.name);
                    return index < 0 ? undefined : new Map([[index, 'boolean']]);
                };
                if (isAssignmentStatement(item)) {
                    if (!allowAssignment || current.$container.$type !== 'Program'
                        || item.name.includes('.') || current.parameters.includes(item.name)) return undefined;
                    if (['+=', '-=', '*='].includes(item.operator)
                        && (selectorLocals.has(item.name) || scalarLocals.has(item.name))) {
                        const reads = onlyReads(item.value, parameter, selectorLocals, scalarLocals, false);
                        if (!reads) return undefined;
                        selectorLocals.delete(item.name);
                        scalarLocals.add(item.name);
                        return reads;
                    }
                    if (item.operator !== '=') return undefined;
                    if (isApplicationExpression(item.value)) {
                        const parts = flattenApplication(item.value);
                        const receiver = parts[0], operation = parts.at(-1);
                        const index = isNameExpression(receiver) ? current.parameters.indexOf(receiver.name) : -1;
                        if (parts.length === 2 && index >= 0 && isNameExpression(operation)
                            && operation.name === 'len' && !current.parameters.includes('len') && builtin('len')) {
                            selectorLocals.set(item.name, new Set());
                            scalarLocals.delete(item.name);
                            return index === current.parameters.indexOf(parameter) ? new Map()
                                : new Map([[index, 'flat-array']]);
                        }
                    }
                    const guards = integerGuards(item.value, current, parameter, selectorLocals);
                    if (guards) {
                        selectorLocals.set(item.name, guards);
                        scalarLocals.delete(item.name);
                        return integerTypes(guards);
                    }
                    const reads = onlyReads(item.value, parameter, selectorLocals, scalarLocals, false);
                    if (!reads) return undefined;
                    selectorLocals.delete(item.name);
                    scalarLocals.add(item.name);
                    return reads;
                }
                // A bare array can feed a lazy result, even inside arithmetic.
                // Only the indexed-read case below consumes a flat scalar cell.
                if (isNameExpression(item)) return scalarLocals.has(item.name) ? new Map()
                    : selectorLocals.has(item.name) ? integerTypes(selectorLocals.get(item.name)!) : undefined;
                if (isReturnStatement(item) && directName(item.value, parameter)) return undefined;
                if (isIfStatement(item)) {
                    const guards = booleanGuards(item.condition);
                    if (!guards) return undefined;
                    for (const clause of item.elifClauses) {
                        const next = booleanGuards(clause.condition);
                        if (!next || !mergeGuards(guards, next)) return undefined;
                    }
                    const bodies = [item.thenStatements, ...item.elifClauses.map(clause => clause.statements), item.elseStatements];
                    const outcomes = [] as { selectors: Map<string, ReadonlySet<number>>; scalars: Set<string> }[];
                    for (const body of bodies) {
                        const selectors = new Map(selectorLocals), scalars = new Set(scalarLocals);
                        const next = onlyReads(body, parameter, selectors, scalars, allowAssignment);
                        if (!next || !mergeGuards(guards, next)) return undefined;
                        outcomes.push({ selectors, scalars });
                    }
                    const first = outcomes[0];
                    selectorLocals.clear();
                    for (const name of first.selectors.keys()) {
                        if (outcomes.every(({ selectors }) => selectors.has(name))) {
                            selectorLocals.set(name, new Set(outcomes.flatMap(({ selectors }) => [...selectors.get(name)!])));
                        }
                    }
                    scalarLocals.clear();
                    for (const name of first.scalars) {
                        if (outcomes.every(({ scalars }) => scalars.has(name))) scalarLocals.add(name);
                    }
                    return guards;
                }
                if (isForStatement(item)) {
                    const condition = item.condition;
                    if (current.$container.$type !== 'Program' || !condition || !isBinaryExpression(condition)
                        || condition.operator !== 'in' || !isNameExpression(condition.left)
                        || current.parameters.includes(condition.left.name)
                        || selectorLocals.has(condition.left.name) || scalarLocals.has(condition.left.name)) return undefined;
                    let iterable = condition.right;
                    while (isParenthesizedExpression(iterable)) iterable = iterable.value;
                    if (!isBinaryExpression(iterable)
                        || (iterable.operator !== 'until' && iterable.operator !== 'to') || iterable.step) return undefined;
                    const start = integerGuards(iterable.left, current, parameter, selectorLocals);
                    const end = integerGuards(iterable.right, current, parameter, selectorLocals);
                    if (!start || !end) return undefined;
                    const selectors = new Map(selectorLocals);
                    selectors.set(condition.left.name, new Set());
                    const scalars = new Set(scalarLocals);
                    const body = onlyReads(item.statements, parameter, selectors, scalars, true);
                    if (!body) return undefined;
                    const knownBefore = new Set([...selectorLocals.keys(), ...scalarLocals]);
                    const knownAfter = new Set([...selectors.keys(), ...scalars]);
                    for (const name of [...selectorLocals.keys()]) {
                        const after = selectors.get(name);
                        if (after) selectorLocals.set(name, new Set([...selectorLocals.get(name)!, ...after]));
                        else selectorLocals.delete(name);
                    }
                    scalarLocals.clear();
                    for (const name of knownBefore) if (knownAfter.has(name)) scalarLocals.add(name);
                    const guards = integerTypes(new Set([...start, ...end]));
                    return mergeGuards(guards, body) ? guards : undefined;
                }
                if (isApplicationExpression(item)) {
                    // Only direct numeric indexing is known to read a flat array.
                    const directGuards = item.arguments.map(selector => integerGuards(selector, current, parameter, selectorLocals));
                    if (directName(item.head, parameter)
                        && directGuards.every((guards): guards is Set<number> => guards !== undefined)) {
                        const guards: Guards = new Map();
                        for (const required of directGuards) {
                            mergeGuards(guards, integerTypes(required));
                        }
                        return guards;
                    }
                    const parts = flattenApplication(item);
                    const target = parts.at(-1)!;
                    const receiver = parts[0];
                    const receiverIndex = isNameExpression(receiver) ? current.parameters.indexOf(receiver.name) : -1;
                    if (receiverIndex >= 0 && parts.length === 2 && isNameExpression(target)
                        && target.name === 'len' && !current.parameters.includes('len') && builtin('len')) {
                        return receiverIndex === current.parameters.indexOf(parameter) ? new Map()
                            : new Map([[receiverIndex, 'flat-array']]);
                    }
                    if (receiverIndex >= 0 && receiverIndex !== current.parameters.indexOf(parameter)
                        && directGuards.every((guards): guards is Set<number> => guards !== undefined)) {
                        const guards: Guards = new Map([[receiverIndex, 'flat-array']]);
                        for (const required of directGuards) {
                            if (!mergeGuards(guards, integerTypes(required))) return undefined;
                        }
                        return guards;
                    }
                    if (isNameExpression(target) && (target.name === 'min' || target.name === 'max')
                        && parts.length === 3 && !current.parameters.includes(target.name)
                        && builtin(target.name)) {
                        return onlyReads(parts.slice(0, -1), parameter, selectorLocals, scalarLocals, false);
                    }
                    if (!isNameExpression(target) || current.parameters.includes(target.name)
                        || parts.slice(0, -1).filter(part => directName(part, parameter)).length !== 1) return undefined;
                    const helper = resolve(target.name);
                    if (!helper || helper.parameters.length !== parts.length - 1) return undefined;
                    const arrayIndex = parts.slice(0, -1).findIndex(part => directName(part, parameter));
                    const helperGuards = inspect(helper).get(arrayIndex);
                    if (!helperGuards) return undefined;
                    const guards: Guards = new Map();
                    for (const [index, part] of parts.slice(0, -1).entries()) {
                        if (index === arrayIndex) continue;
                        const required = helperGuards.get(index);
                        let mapped: Guards | undefined;
                        if (required === 'boolean') mapped = booleanGuards(part);
                        else {
                            const integers = integerGuards(part, current, parameter, selectorLocals);
                            if (integers) mapped = integerTypes(integers);
                        }
                        if (!mapped || !mergeGuards(guards, mapped)) return undefined;
                    }
                    return guards;
                }
                switch (item.$type) {
                    case 'ReturnStatement':
                    case 'ExpressionStatement':
                    case 'BinaryExpression':
                    case 'UnaryExpression':
                    case 'ParenthesizedExpression':
                    case 'NumberLiteral':
                    case 'BooleanLiteral':
                    case 'StringLiteral':
                    case 'LabelLiteral':
                        return onlyReads(Object.entries(item).filter(([key]) => !key.startsWith('$'))
                            .map(([, child]) => child), parameter, selectorLocals, scalarLocals, false);
                    default:
                        return undefined;
                }
            };
            const result = new Map<number, Guards>();
            current.parameters.forEach((parameter, index) => {
                const guards = onlyReads(current.statements, parameter, new Map(), new Set(), true);
                if (guards) result.set(index, guards);
            });
            cache.set(current, result);
            return result;
        } finally { active.delete(current); }
    };
    return inspect(definition);
}
