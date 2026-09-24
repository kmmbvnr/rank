import { AstUtils } from 'langium';
import {
    isApplicationExpression, isArrayAssignmentStatement, isArrayExpression, isAssignmentStatement,
    isBinaryExpression, isBooleanLiteral, isBreakStatement, isContinueStatement, isExpressionStatement,
    isForStatement, isFunctionStatement, isIfStatement, isLabelLiteral,
    isNameExpression, isNumberLiteral, isParenthesizedExpression, isReturnStatement, isStdinExpression,
    isStringLiteral, isTextBlockExpression, isTryStatement, isUnaryExpression, isYieldStatement,
    type ArrayAssignmentStatement, type Expression, type FunctionStatement, type Statement,
} from '../generated/ast.js';
import { flattenApplication, groupedUnaryDyadicChain } from '../expressions.js';
import { findOperation } from '../operations.js';
import { expressionFacts, hasArrayHeaderNoCallbackProof, hasMappedScalarNoCallbackProof, hasNumericArrayNoCallbackProof,
    hasScalarCellArrayNoCallbackProof, hasScalarNoCallbackProof,
    joinValueFacts, UNKNOWN_VALUE, type ValueFacts } from './value-facts.js';

/** Possible effects, not a purity promise. Unknown includes unsupported syntax. */
export interface FunctionEffects {
    readonly unknown: boolean;
    readonly parameters: ReadonlySet<number>;
    readonly reboundParameters: ReadonlySet<number>;
    readonly captures: ReadonlySet<string>;
    readonly bindingCaptures: ReadonlySet<string>;
    readonly globalWriteCaptures: ReadonlySet<string>;
    readonly readParameters: ReadonlySet<number>;
    readonly readCaptures: ReadonlySet<string>;
    readonly globalReadCaptures: ReadonlySet<string>;
    readonly valueCaptures: ReadonlySet<string>;
    readonly globalValueCaptures: ReadonlySet<string>;
    readonly io: boolean;
    readonly returns: readonly ReturnOrigin[];
}

/** A return path's relation to inputs. Unknown includes possible escape. */
export type ReturnOrigin = { readonly kind: 'fresh' | 'unknown' }
    | { readonly kind: 'parameter'; readonly index: number }
    | { readonly kind: 'capture'; readonly name: string };

/** Resolve only definitions whose binding identity is still known at the call site. */
export function functionEffects(resolve: (name: string) => FunctionStatement | undefined,
    isFunction: (name: string) => boolean,
    isBound: (name: string) => boolean = () => false): (name: string, arguments_?: readonly ValueFacts[]) => FunctionEffects {
    const cache = new WeakMap<FunctionStatement, FunctionEffects>();
    const active = new WeakSet<FunctionStatement>();
    const unknown: FunctionEffects = { unknown: true, parameters: new Set(), reboundParameters: new Set(),
        captures: new Set(), bindingCaptures: new Set(),
        globalWriteCaptures: new Set(),
        readParameters: new Set(), readCaptures: new Set(), globalReadCaptures: new Set(),
        valueCaptures: new Set(), globalValueCaptures: new Set(), io: false,
        returns: [{ kind: 'unknown' }] };
    let budget = 100;
    const initialLocals = (function_: FunctionStatement): ReadonlySet<string> => {
        const names = new Set<string>();
        for (const item of function_.statements) {
            if (!isAssignmentStatement(item) || item.operator !== '=' || item.name.includes('.')) break;
            if (!function_.parameters.includes(item.name)) names.add(item.name);
        }
        return names;
    };
    function analyze(definition: FunctionStatement, inputs?: readonly ValueFacts[]): FunctionEffects {
        const cached = inputs ? undefined : cache.get(definition);
        if (cached) return cached;
        if (active.has(definition) || budget-- <= 0) return unknown;
        if (new Set(definition.parameters).size !== definition.parameters.length) return unknown;
        const descendants = [...AstUtils.streamAllContents(definition)].filter(node => {
            let parent = node.$container;
            while (parent && parent !== definition && !isFunctionStatement(parent)) parent = parent.$container;
            return parent === definition;
        });
        // Without a return, callers cannot resume normally. The diagnostic
        // pass does not yet model this unreachable continuation.
        if (!descendants.some(isReturnStatement)) return unknown;
        const parameters = new Set<number>();
        const reboundParameters = new Set<number>();
        const captures = new Set<string>();
        const bindingCaptures = new Set<string>();
        const globalWriteCaptures = new Set<string>();
        const readParameters = new Set<number>();
        const readCaptures = new Set<string>();
        const globalReadCaptures = new Set<string>();
        const valueCaptures = new Set<string>();
        const globalValueCaptures = new Set<string>();
        let io = false;
        const assignments = new Set(descendants
            .filter(isAssignmentStatement).map(node => node.name));
        const parent = isFunctionStatement(definition.$container) ? definition.$container : undefined;
        const parentLocals = parent?.$container.$type === 'Program' ? initialLocals(parent) : new Set<string>();
        const grandparent = parent && isFunctionStatement(parent.$container) ? parent.$container : undefined;
        const grandparentLocals = grandparent?.$container.$type === 'Program'
            ? initialLocals(grandparent) : new Set<string>();
        const unshadowedGrandparent = (name: string): boolean => !!parent && !!grandparent
            && (grandparent.parameters.includes(name) || grandparentLocals.has(name))
            && !parent.parameters.includes(name)
            && parent.statements.every(item => isFunctionStatement(item) ? item.name !== name
                : isAssignmentStatement(item) ? item.name !== name
                    : isExpressionStatement(item) || isReturnStatement(item));
        const capturedBindings = new Set([...(parent?.parameters ?? []), ...parentLocals,
            ...[...assignments].filter(unshadowedGrandparent)]
            .filter(name => assignments.has(name) && !definition.parameters.includes(name)));
        const stableLocals = definition.$container.$type === 'Program' ? initialLocals(definition) : new Set<string>();
        const changedLocals = new Set<string>();
        const localFunctions = new Map(definition.statements.filter(isFunctionStatement)
            .map(node => [node.name, node]));
        const locals = new Set([...definition.parameters,
            ...[...assignments].filter(name => !capturedBindings.has(name)), ...localFunctions.keys()]);
        const facts = inputs && inputs.length === definition.parameters.length
            ? new Map(definition.parameters.map((name, index) => [name, inputs[index]] as const)) : undefined;
        const fact = (value: Expression): ValueFacts => expressionFacts(value,
            name => changedLocals.has(name) || reboundParameters.has(definition.parameters.indexOf(name))
                ? UNKNOWN_VALUE : facts?.get(name) ?? (isFunction(name) ? { types: ['function'] } : undefined));
        const helperFor = (name: string): FunctionStatement | undefined => {
            const local = localFunctions.get(name);
            if (local) return local;
            if (locals.has(name)) return undefined;
            const global = resolve(name);
            return global?.$container.$type === 'Program' ? global : undefined;
        };
        const eagerLocals = new Set<string>();
        const privateArrays = new Set<string>();
        for (const item of definition.statements) {
            if (!isAssignmentStatement(item) || item.operator !== '=' || item.name.includes('.')) break;
            if (!isArrayExpression(item.value)
                || definition.$container.$type !== 'Program' || definition.parameters.includes(item.name)
                || item.value.dimensions.length || item.value.rows.length || item.value.fill
                || !item.value.items.every(cell => isNumberLiteral(cell.value)
                    || isBooleanLiteral(cell.value) || isLabelLiteral(cell.value))) continue;
            if (descendants.filter(isAssignmentStatement).filter(other => other.name === item.name).length !== 1) continue;
            const writes = descendants.filter((node): node is ArrayAssignmentStatement =>
                isArrayAssignmentStatement(node) && node.name === item.name);
            const privateArray = !descendants.some(isFunctionStatement);
            if (!writes.length || privateArray && writes.every(write => isPlainArrayWrite(write)
                && write.indices.every(index => !index.all)
                && (isNumberLiteral(write.value) || isBooleanLiteral(write.value) || isLabelLiteral(write.value)))) {
                eagerLocals.add(item.name);
            }
            if (privateArray) privateArrays.add(item.name);
        }
        const origin = (value: Expression | undefined, aliases: ReadonlyMap<string, ReturnOrigin>): readonly ReturnOrigin[] => {
            while (value && isParenthesizedExpression(value)) value = value.value;
            if (value && isNameExpression(value)) {
                if (changedLocals.has(value.name)) return [{ kind: 'unknown' }];
                const callee = helperFor(value.name);
                if (callee?.parameters.length === 0) {
                    const helper = analyze(callee);
                    if (!helper.unknown) return helper.returns.map(item => item.kind === 'capture'
                        ? callee.$container === definition && definition.parameters.includes(item.name)
                            ? { kind: 'parameter', index: definition.parameters.indexOf(item.name) }
                            : { kind: 'unknown' } : item);
                }
                const alias = aliases.get(value.name);
                if (alias) return [alias];
                const index = definition.parameters.indexOf(value.name);
                if (index >= 0) return [{ kind: 'parameter', index }];
                return [locals.has(value.name) || isFunction(value.name) ? { kind: 'unknown' }
                    : { kind: 'capture', name: value.name }];
            }
            if (value && isApplicationExpression(value)) {
                const parts = flattenApplication(value);
                const target = parts.at(-1)!;
                const callee = isNameExpression(target) ? helperFor(target.name) : undefined;
                if (callee?.parameters.length === parts.length - 1) {
                    const helper = analyze(callee);
                    if (!helper.unknown) return helper.returns.flatMap(item => {
                        if (item.kind === 'parameter') return origin(parts[item.index], aliases);
                        // A capture belongs to the helper's lexical scope,
                        // which a name in this caller cannot identify safely.
                        if (item.kind === 'capture') return callee.$container === definition
                            ? origin({ $type: 'NameExpression', name: item.name } as Expression, aliases)
                            : [{ kind: 'unknown' }];
                        return [item];
                    });
                }
            }
            if (value && !definition.memo && ![value, ...AstUtils.streamAllContents(value)]
                .some(node => isNameExpression(node) || isApplicationExpression(node)
                    || node.$type === 'StdinExpression' || node.$type === 'MaterializeExpression')
                && expression(value)) {
                return [{ kind: 'fresh' }];
            }
            return [{ kind: 'unknown' }];
        };
        const returnOrigins = (): readonly ReturnOrigin[] => {
            const same = (a: ReturnOrigin, b: ReturnOrigin) => JSON.stringify(a) === JSON.stringify(b);
            const merge = (paths: readonly Map<string, ReturnOrigin>[]): Map<string, ReturnOrigin> => {
                const merged = new Map<string, ReturnOrigin>();
                for (const name of new Set(paths.flatMap(path => [...path.keys()]))) {
                    const values = paths.map(path => path.get(name));
                    merged.set(name, values.every(value => value && same(value, values[0]!))
                        ? values[0]! : { kind: 'unknown' });
                }
                return merged;
            };
            const returned: ReturnOrigin[] = [];
            const walk = (items: readonly Statement[], aliases: Map<string, ReturnOrigin>): Map<string, ReturnOrigin> | undefined => {
                for (const item of items) {
                    if (isAssignmentStatement(item)) {
                        const values = item.operator === '=' ? origin(item.value, aliases) : [{ kind: 'unknown' } as const];
                        aliases.set(item.name, values.length === 1 ? values[0] : { kind: 'unknown' });
                    } else if (isReturnStatement(item)) {
                        returned.push(...origin(item.value, aliases));
                        return undefined;
                    } else if (isIfStatement(item)) {
                        const paths = [item.thenStatements, ...item.elifClauses.map(clause => clause.statements),
                            item.elseStatements];
                        const survivors = paths.map(path => walk(path, new Map(aliases)))
                            .filter((path): path is Map<string, ReturnOrigin> => path !== undefined);
                        if (!survivors.length) return undefined;
                        aliases = merge(survivors);
                    } else if (isForStatement(item)) {
                        const loopAliases = new Map(aliases);
                        for (const node of AstUtils.streamAllContents(item)) {
                            if (isAssignmentStatement(node)) loopAliases.set(node.name, { kind: 'unknown' });
                        }
                        walk(item.statements, new Map(loopAliases));
                        aliases = loopAliases;
                    }
                }
                return aliases;
            };
            // Fallthrough throws instead of returning an unknown value.
            walk(definition.statements, new Map());
            const origins = new Map<string, ReturnOrigin>();
            for (const item of returned) {
                origins.set(JSON.stringify(item), item);
            }
            return [...origins.values()];
        };
        const write = (target: string): boolean => {
            // Rebound parameters and local aliases need provenance analysis.
            if (assignments.has(target) || target.includes('.')) return false;
            const index = definition.parameters.indexOf(target);
            if (index >= 0) parameters.add(index);
            else {
                captures.add(target);
                if (definition.$container.$type === 'Program') globalWriteCaptures.add(target);
            }
            return true;
        };
        const read = (target: string): boolean => {
            if (target.includes('.') || isFunction(target)) return false;
            if (assignments.has(target)) return !changedLocals.has(target) && (eagerLocals.has(target)
                || facts?.get(target)?.eagerScalarCells === true
                || facts?.get(target)?.callbackFreeScalarCells === true);
            const index = definition.parameters.indexOf(target);
            if (index >= 0) readParameters.add(index);
            else if (!locals.has(target)) {
                readCaptures.add(target);
                if (definition.$container.$type === 'Program') globalReadCaptures.add(target);
            }
            else return false;
            return true;
        };
        const propagate = (name: string, arguments_: readonly Expression[]): boolean => {
            const helper = helperFor(name);
            if (!helper) {
                if (name === 'raise' && !isBound(name) && arguments_.length === 1
                    && isLabelLiteral(arguments_[0])) return true;
                const operation = !isBound(name) && findOperation(name);
                if (!operation || !operation.arities.includes(arguments_.length)
                    || !arguments_.every(expression)) return false;
                if (operation.effects?.includes('io')) {
                    io = true;
                    return true;
                }
                if (!facts || operation.effects?.length) return false;
                if (operation.arrayHeaderNoCallback) {
                    return hasArrayHeaderNoCallbackProof(operation, arguments_.map(fact));
                }
                if (name === 'max' && arguments_.length === 2) return arguments_.every(argument => {
                    const value = fact(argument);
                    return value.rank === 0 && value.types.length > 0
                        && value.types.every(type => type === 'integer' || type === 'real');
                });
                if (operation.scalarNoCallback) {
                    const operands = arguments_.map(fact);
                    return hasScalarNoCallbackProof(operation, operands)
                        || hasMappedScalarNoCallbackProof(operation, operands)
                        || hasNumericArrayNoCallbackProof(operation, operands);
                }
                if (operation.scalarCellArrayNoCallback) {
                    return hasScalarCellArrayNoCallbackProof(operation, arguments_.map(fact));
                }
                if (operation.numericArrayNoCallback) {
                    return hasNumericArrayNoCallbackProof(operation, arguments_.map(fact));
                }
                return false;
            }
            if (helper.parameters.length !== arguments_.length) return false;
            const effects = analyze(helper);
            if (effects.unknown || !arguments_.every(expression)) return false;
            io ||= effects.io;
            // Direct nested captures can name this function's parameters.
            // Other local collisions have no proven binding identity.
            for (const capture of effects.captures) {
                if (helper.$container === definition && definition.parameters.includes(capture)) {
                    if (assignments.has(capture)) return false;
                    parameters.add(definition.parameters.indexOf(capture));
                    continue;
                }
                if (locals.has(capture) && !effects.globalWriteCaptures.has(capture)) return false;
                captures.add(capture);
                if (effects.globalWriteCaptures.has(capture)
                    || helper.$container === definition && definition.$container.$type === 'Program') globalWriteCaptures.add(capture);
            }
            for (const capture of effects.bindingCaptures) {
                if (helper.$container !== definition) return false;
                if (definition.parameters.includes(capture)) reboundParameters.add(definition.parameters.indexOf(capture));
                else if (stableLocals.has(capture)) changedLocals.add(capture);
                else if (parentLocals.has(capture) || parent?.parameters.includes(capture)) bindingCaptures.add(capture);
                else return false;
            }
            for (const capture of effects.readCaptures) {
                if (helper.$container === definition && definition.parameters.includes(capture)) {
                    if (assignments.has(capture)) return false;
                    readParameters.add(definition.parameters.indexOf(capture));
                    continue;
                }
                if (helper.$container === definition && eagerLocals.has(capture)) continue;
                if (locals.has(capture) && !effects.globalReadCaptures.has(capture)) return false;
                readCaptures.add(capture);
                if (effects.globalReadCaptures.has(capture)
                    || helper.$container === definition && definition.$container.$type === 'Program') globalReadCaptures.add(capture);
            }
            for (const capture of effects.valueCaptures) {
                if (helper.$container === definition && definition.parameters.includes(capture)) {
                    if (assignments.has(capture)) return false;
                    continue;
                }
                if (locals.has(capture) && !effects.globalValueCaptures.has(capture)) return false;
                valueCaptures.add(capture);
                if (effects.globalValueCaptures.has(capture)
                    || helper.$container === definition && definition.$container.$type === 'Program') globalValueCaptures.add(capture);
            }
            for (const index of effects.parameters) {
                let argument = arguments_[index];
                while (isParenthesizedExpression(argument)) argument = argument.value;
                if (!isNameExpression(argument)) return false;
                if (privateArrays.has(argument.name) && !effects.readParameters.has(index)) {
                    // The helper can change this activation's private array,
                    // but the changed cells no longer have a known eager type.
                    changedLocals.add(argument.name);
                    eagerLocals.delete(argument.name);
                    continue;
                }
                if (!write(argument.name)) return false;
            }
            for (const index of effects.readParameters) {
                let argument = arguments_[index];
                while (isParenthesizedExpression(argument)) argument = argument.value;
                if (!isNameExpression(argument) || !read(argument.name)) return false;
            }
            return true;
        };
        const expression = (value: Expression): boolean => {
            if (isNameExpression(value)) {
                if (localFunctions.has(value.name)) return propagate(value.name, []);
                if (locals.has(value.name)) return true;
                if (isFunction(value.name)) return propagate(value.name, []);
                if (!value.name.includes('.') && /^[A-Z]/.test(value.name) && !isFunction(value.name)) {
                    valueCaptures.add(value.name);
                    if (definition.$container.$type === 'Program') globalValueCaptures.add(value.name);
                    return true;
                }
                return false;
            }
            if (isApplicationExpression(value)) {
                const grouped = groupedUnaryDyadicChain(value, name => !isBound(name)
                    && !locals.has(name) && !isFunction(name));
                if (grouped) return expression(grouped);
                const parts = flattenApplication(value);
                if (isNameExpression(parts[0]) && parts.length > 1 && parts.slice(1).every(part =>
                    isNumberLiteral(part) && typeof part.value === 'bigint'
                    || facts && fact(part).rank === 0 && fact(part).types.join() === 'integer')) {
                    return read(parts[0].name);
                }
                const target = parts.at(-1)!;
                if (!isNameExpression(target) || locals.has(target.name) && !localFunctions.has(target.name)) return false;
                return propagate(target.name, parts.slice(0, -1));
            }
            if (isNumberLiteral(value) || isStringLiteral(value) || isBooleanLiteral(value)
                || isLabelLiteral(value) || isTextBlockExpression(value)) return true;
            if (isStdinExpression(value)) {
                io = true;
                return !value.count || expression(value.count);
            }
            if (isParenthesizedExpression(value)) return expression(value.value);
            if (isUnaryExpression(value)) return expression(value.operand);
            if (isBinaryExpression(value)) return expression(value.left) && expression(value.right)
                && (!value.step || expression(value.step));
            if (isArrayExpression(value)) return [...value.items, ...value.dimensions, ...value.rows.flatMap(row => row.items)]
                .every(item => expression(item.value)) && (!value.fill || expression(value.fill));
            return false;
        };
        const statement = (item: Statement): boolean => {
            if (isFunctionStatement(item)) return localFunctions.get(item.name) === item && !item.memo;
            // Runtime assignment searches enclosing frames before making a local.
            if (isAssignmentStatement(item)) {
                if (item.name.includes('.') || !expression(item.value)) return false;
                if (item.operator === '=') {
                    if (facts) facts.set(item.name, fact(item.value));
                } else {
                    if (!facts || !['+=', '-=', '*=', '//=', '%='].includes(item.operator)) return false;
                    const target = fact({ $type: 'NameExpression', name: item.name } as Expression);
                    const value = fact(item.value);
                    if ([target, value].every(part => part.rank === 0 && part.types.join() === 'integer')) {
                        facts.set(item.name, { types: ['integer'], rank: 0, shape: [] });
                    } else {
                        const numericArray = (part: ValueFacts) => part.types.join() === 'array'
                            && (part.eagerScalarCells === true || part.callbackFreeScalarCells === true)
                            && !!part.elements?.length
                            && part.elements.every(type => type === 'integer' || type === 'real');
                        if (definition.parameters.includes(item.name) || capturedBindings.has(item.name)
                            || !numericArray(target) || !numericArray(value)
                            || target.rank === undefined || target.rank !== value.rank
                            || !target.shape || !value.shape
                            || target.shape.some((size, axis) => size !== null && value.shape![axis] !== null
                                && size !== value.shape![axis])) return false;
                        facts.set(item.name, { types: ['array'], rank: target.rank, shape: target.shape,
                            elements: ['integer', 'real'], callbackFreeScalarCells: true });
                    }
                }
                if (capturedBindings.has(item.name)) {
                    bindingCaptures.add(item.name);
                    return true;
                }
                return definition.parameters.includes(item.name) || definition.$container.$type === 'Program';
            }
            if (isArrayAssignmentStatement(item)) {
                if (!isPlainArrayWrite(item)) return false;
                if (privateArrays.has(item.name)) {
                    if (!expression(item.value) || !item.indices.every(index => !index.value || expression(index.value))) return false;
                    if ([item.value, ...AstUtils.streamAllContents(item.value)].some(node =>
                        isNameExpression(node) || isApplicationExpression(node) || isStdinExpression(node))) {
                        changedLocals.add(item.name);
                    }
                    return true;
                }
                return write(item.name) && expression(item.value)
                    && item.indices.every(index => !index.value || expression(index.value));
            }
            if (isExpressionStatement(item)) return expression(item.value);
            if (isReturnStatement(item)) return !item.value || expression(item.value);
            if (isForStatement(item) && facts && item.condition && isBinaryExpression(item.condition)
                && item.condition.operator === 'in') {
                const iterable = fact(item.condition.right);
                if ((iterable.types.join() === 'array' || iterable.types.join() === 'sequence')
                    && iterable.shape?.[0] === 0 && expression(item.condition.right)) return true;
            }
            if (isForStatement(item) && facts && item.condition && isBinaryExpression(item.condition)
                && item.condition.operator === 'in' && isNameExpression(item.condition.left)
                && !definition.parameters.includes(item.condition.left.name)
                && (definition.$container.$type === 'Program' || !isBound(item.condition.left.name))
                && !localFunctions.has(item.condition.left.name)
                && !item.statements.some(body => [body, ...AstUtils.streamAllContents(body)]
                    .some(node => isBreakStatement(node) || isContinueStatement(node)
                        || isYieldStatement(node) || isTryStatement(node)))
                && expression(item.condition.right)) {
                const iterable = item.condition.right;
                const source = fact(iterable);
                let element: ValueFacts;
                if (isBinaryExpression(iterable) && (iterable.operator === 'to' || iterable.operator === 'until')
                    && [iterable.left, iterable.right, ...(iterable.step ? [iterable.step] : [])]
                        .every(bound => fact(bound).rank === 0 && fact(bound).types.join() === 'integer')
                    && source.types.join() === 'sequence' && source.elements?.join() === 'integer') {
                    element = { types: ['integer'], rank: 0, shape: [] };
                } else if (isNameExpression(iterable) && definition.parameters.includes(iterable.name)
                    && source.types.join() === 'text' && read(iterable.name)) {
                    element = { types: ['text'], rank: 1, shape: [null] };
                } else return false;
                const binder = item.condition.left.name;
                locals.add(binder);
                const initial = new Map(facts);
                let entry = initial;
                let settled = false;
                for (let pass = 0; pass < 4; pass++) {
                    facts.clear();
                    for (const [name, value] of entry) facts.set(name, value);
                    facts.set(binder, element);
                    if (!item.statements.every(statement)) return false;
                    const next = new Map<string, ValueFacts>();
                    for (const name of new Set([...initial.keys(), ...facts.keys()])) {
                        if (name === binder) continue;
                        next.set(name, joinValueFacts([initial.get(name) ?? UNKNOWN_VALUE,
                            facts.get(name) ?? UNKNOWN_VALUE]));
                    }
                    settled = [...next].every(([name, value]) => JSON.stringify(value) === JSON.stringify(entry.get(name)));
                    entry = next;
                    if (settled) break;
                }
                if (!settled) return false;
                facts.clear();
                for (const [name, value] of entry) facts.set(name, value);
                return true;
            }
            if (isForStatement(item) && facts && item.condition
                && !(isBinaryExpression(item.condition) && item.condition.operator === 'in')
                && !item.statements.some(body => [body, ...AstUtils.streamAllContents(body)]
                    .some(node => isBreakStatement(node) || isContinueStatement(node)
                        || isYieldStatement(node) || isTryStatement(node)))) {
                const initial = new Map(facts);
                let entry = initial;
                let settled = false;
                for (let pass = 0; pass < 4; pass++) {
                    facts.clear();
                    for (const [name, value] of entry) facts.set(name, value);
                    if (!expression(item.condition) || !item.statements.every(statement)) return false;
                    const next = new Map<string, ValueFacts>();
                    for (const name of new Set([...initial.keys(), ...facts.keys()])) {
                        next.set(name, joinValueFacts([initial.get(name) ?? UNKNOWN_VALUE,
                            facts.get(name) ?? UNKNOWN_VALUE]));
                    }
                    settled = [...next].every(([name, value]) => JSON.stringify(value) === JSON.stringify(entry.get(name)));
                    entry = next;
                    if (settled) break;
                }
                if (!settled) return false;
                facts.clear();
                for (const [name, value] of entry) facts.set(name, value);
                return true;
            }
            if (isIfStatement(item)) {
                if (!facts) return expression(item.condition) && item.thenStatements.every(statement)
                    && item.elifClauses.every(clause => expression(clause.condition) && clause.statements.every(statement))
                    && item.elseStatements.every(statement);
                const before = new Map(facts);
                const paths: Map<string, ValueFacts>[] = [];
                for (const [condition, body] of [[item.condition, item.thenStatements] as const,
                    ...item.elifClauses.map(clause => [clause.condition, clause.statements] as const)]) {
                    facts.clear();
                    for (const [name, value] of before) facts.set(name, value);
                    if (!expression(condition) || !body.every(statement)) return false;
                    paths.push(new Map(facts));
                }
                facts.clear();
                for (const [name, value] of before) facts.set(name, value);
                if (!item.elseStatements.every(statement)) return false;
                paths.push(new Map(facts));
                facts.clear();
                for (const name of new Set(paths.flatMap(path => [...path.keys()]))) {
                    facts.set(name, joinValueFacts(paths.map(path => path.get(name) ?? UNKNOWN_VALUE)));
                }
                return true;
            }
            return false;
        };
        active.add(definition);
        try {
            let origins: readonly ReturnOrigin[] | undefined;
            const result = definition.statements.every(statement) ? {
                unknown: false, parameters, reboundParameters, captures, bindingCaptures, globalWriteCaptures,
                readParameters, readCaptures, globalReadCaptures,
                valueCaptures, globalValueCaptures, io,
                get returns() { return origins ??= returnOrigins().map(item =>
                    item.kind === 'parameter' && (parameters.has(item.index) || reboundParameters.has(item.index))
                    || item.kind === 'capture' && (captures.has(item.name) || bindingCaptures.has(item.name))
                        ? { kind: 'unknown' } : item); },
            } : unknown;
            if (!inputs) cache.set(definition, result);
            return result;
        } finally { active.delete(definition); }
    }
    return (name, arguments_) => {
        const definition = resolve(name);
        if (!definition) return unknown;
        const specific = arguments_ ? analyze(definition, arguments_) : unknown;
        return specific.unknown ? analyze(definition) : specific;
    };
}

/** Numeric/whole-axis replacement cannot invoke a table field or container callback. */
export function isPlainArrayWrite(statement: ArrayAssignmentStatement,
    integer: (value: Expression) => boolean = value => isNumberLiteral(value)
        && typeof value.value === 'bigint'): boolean {
    return statement.operator === '=' && statement.indices.every(index => !index.spread
        && (index.all || index.value !== undefined && integer(index.value)));
}
