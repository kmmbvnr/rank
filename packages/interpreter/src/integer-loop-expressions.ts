import { binaryOperatorSource, zeroTestSource } from './operator-codegen.js';
import { loopValueType, type LoopHost, type LoopTerm } from './integer-loop-plan.js';
import { compiledIntegerMembership } from './integer-membership.js';
import { type CompiledCalleeType } from './compiled-callee-type.js';
import { ResourceMap } from './resource-summary.js';
import { IndexEntries } from './index-storage.js';
import { compiledArgumentType } from './compiled-argument-type.js';
import {
    flattenApplication, expressionFacts, findOperation, findCompiledOperator, inferCompiledExpression,
    loopOperatorSignature, isApplicationExpression, isBinaryExpression, isUnaryExpression, isStringLiteral,
    isParenthesizedExpression, isNumberLiteral, isNameExpression, type Expression, type CompiledLoopType,
    type CompiledExpression, type Operation,
} from '@arrrank/language';
import { isRankArray, isRankIndex } from './value.js';
import { RankDeque } from './containers.js';
import { denseScalarItems, materializedArrayItems, arrayRevision } from './array-storage.js';

import type { LoopCompilationState } from './integer-loop-state.js';

/** Pure builtins inlined as `Value name`; runtime entry rechecks their bindings. */
interface InlineBuiltin {
    readonly module: string;
    readonly types: Partial<Record<LoopTerm['type'], LoopTerm['type']>>;
    readonly enabled?: (host: LoopHost) => boolean;
    /** The interpreter's DomainError for operands outside the domain. */
    readonly domain?: { test(value: string, type: LoopTerm['type']): string | undefined; message: string };
    code(value: string, type: LoopTerm['type'], numberMode: boolean): string;
}
const parity = (even: boolean): InlineBuiltin => ({ module: 'numbers', types: { integer: 'boolean' },
    code: (value, _, numberMode) => numberMode ? `((${value}) % 2 ${even ? '===' : '!=='} 0)`
        : `(BigInt.asUintN(1, ${value}) ${even ? '===' : '!=='} 0n)` });
const bound = (name: 'floor' | 'ceil'): InlineBuiltin => ({ module: 'numbers', types: { integer: 'integer', real: 'integer' },
    enabled: host => host.reals,
    domain: { test: (value, type) => type === 'real' ? `!Number.isFinite(${value})` : undefined, message: `${name} expects a finite number` },
    code: (value, type, numberMode) => type === 'real' ? numberMode ? `safe(Math.${name}(${value}))` : `BigInt(Math.${name}(${value}))` : value });
const inlineBuiltins = new Map<string, InlineBuiltin>([
    ['abs', { module: 'numbers', types: { integer: 'integer', real: 'real' }, enabled: host => host.absolute,
        code: (value, type, numberMode) => type === 'real' ? `Math.abs(${value})`
            : `(${value}) < ${numberMode ? '0' : '0n'} ? -(${value}) : (${value})` }],
    ['even', parity(true)],
    ['odd', parity(false)],
    ['sqrt', { module: 'numbers', types: { integer: 'real', real: 'real' }, enabled: host => host.reals,
        domain: { test: value => `(${value}) < 0`, message: 'sqrt expects a nonnegative value' },
        code: (value, type) => `Math.sqrt(${type === 'integer' ? `Number(${value})` : value})` }],
    ['floor', bound('floor')],
    ['ceil', bound('ceil')],
]);

/** Expression lowering records its required bindings on the current plan. */
export function createLoopExpressions(state: LoopCompilationState) {
    const {
        host, numberMode, textSources, safe, localTypes, names, required, assigned, containers, builtins,
        calls, arrays, calleeArrays, arrayInputs, destinations, reject,
    } = state;

    function container(name: string, kind: 'index' | 'deque', integers = false): string | undefined {
        if (name.includes('.')) return undefined;
        const old = containers.get(name);
        if (old && old.kind !== kind) return undefined;
        const info = old ?? { slot: slot(name), kind, integers };
        info.integers ||= integers;
        containers.set(name, info);
        return `r${info.slot}`;
    }
    function slot(name: string): number {
        let index = names.indexOf(name);
        if (index < 0) { index = names.length; names.push(name); }
        return index;
    }
    function knownType(expression: Expression): LoopTerm['type'] | undefined {
        const fact = expressionFacts(expression, name => {
            const local = localTypes.get(name);
            if (local) return { types: [local] };
            // This only selects a specialization; required inputs are guarded
            // again on every entry. Never retain a value or invocation frame.
            const type = loopValueType(host.read(name));
            return type && { types: [type] };
        });
        const type = fact.types.length === 1 ? fact.types[0] : undefined;
        return type === 'integer' || type === 'boolean' || type === 'text' || type === 'bytes'
            || type === 'real' && host.reals ? type : undefined;
    }
    /** Real bindings and arrays of reals select real registers. This only
     * chooses a specialization; entry guards check every input and cell. */
    function realInput(name: string): 'real' | undefined {
        if (!host.reals) return undefined;
        const value = host.read(name);
        const first = value && isRankArray(value)
            ? arrayRevision(value) === undefined ? undefined
                : (denseScalarItems(value) ?? materializedArrayItems(value))?.[0] : value;
        return typeof first === 'number' ? 'real' : undefined;
    }
    const isExtreme = (part: Expression | undefined) => isNameExpression(part) && ['min', 'max'].includes(part.name);
    // `A B max`, `A max`, or a chain such as `A B max 5 min` that ends in scalar extrema.
    function extremeChain(parts: readonly Expression[]): boolean {
        if (!isExtreme(parts.at(-1))) return false;
        if (parts.length === 2 || parts.length === 3) return !isExtreme(parts[0]) && !isExtreme(parts.at(-2));
        return parts.length > 3 && !isExtreme(parts.at(-2)) && extremeChain(parts.slice(0, -2));
    }
    function emitExtreme(parts: readonly Expression[], lines: string[]): LoopTerm | undefined {
        const last = parts.at(-1);
        if (!isNameExpression(last)) return undefined;
        const left = parts.length > 3 ? emitExtreme(parts.slice(0, -2), lines) : emit(parts[0], lines);
        if (left?.type !== 'integer' && left?.type !== 'real') return undefined;
        builtins.set(last.name, 'core');
        if (parts.length === 2) return left;
        // Mixed operands would give a result of either type.
        const right = emit(parts.at(-2)!, lines);
        if (right?.type !== left.type) return undefined;
        const name = `v${state.serial++}`;
        lines.push(`const ${name} = (${right.code}) ${last.name === 'min' ? '<' : '>'} (${left.code}) ? (${right.code}) : (${left.code});`);
        return { code: name, type: left.type };
    }
    interface LoopInput { readonly term: LoopTerm; readonly lines: readonly string[] }
    function emit(e: Expression, lines: string[], hint?: LoopTerm['type'], tail = false): LoopTerm | undefined {
        let tailSource = e;
        while (isParenthesizedExpression(tailSource)) tailSource = tailSource.value;
        const booleanPairs = new Map<Expression, boolean>();
        const types: readonly CompiledLoopType[] = ['integer', 'boolean', 'bytes',
            ...host.textLoops ? ['text' as const] : [], ...host.reals ? ['real' as const] : []];
        const inferred = inferCompiledExpression<CompiledLoopType, LoopInput>(e, {
            atom: type => types.find(candidate => candidate === type),
            read: (source, expected) => {
                // Scalar operators use the shared inference. Loop-specific cell
                // reads, calls and literal powers retain their guarded lowering.
                if (isUnaryExpression(source) || isBinaryExpression(source)
                    && source.operator !== '**' && source.operator !== 'in' && source.operator !== 'notin') return undefined;
                const inputLines: string[] = [];
                const term = emitInput(source, inputLines, expected, tail && source === tailSource);
                return term ? { type: term.type, input: { term, lines: inputLines } } : undefined;
            },
            isBound: name => localTypes.has(name) || arrays.has(name) || containers.has(name),
            operandHint: (source, index, left) => {
                if (isUnaryExpression(source)) return source.operator === 'not' ? 'boolean' : undefined;
                if (!isBinaryExpression(source)) return undefined;
                if (index === 1) return left === 'text' ? 'text'
                    : booleanPairs.get(source) || left === 'boolean' ? 'boolean' : undefined;
                const text = loopOperatorSignature(source.operator, ['text', 'text'], host.nativeCalls);
                const boolean = loopOperatorSignature(source.operator, ['boolean', 'boolean'], host.nativeCalls);
                const textPair = text && knownType(source.right) === 'text';
                const booleanPair = !!boolean && (!loopOperatorSignature(source.operator, ['integer', 'integer'], host.nativeCalls)
                    || knownType(source.right) === 'boolean');
                booleanPairs.set(source, booleanPair);
                return textPair || text?.result === 'text' && knownType(source.left) === 'text'
                    ? 'text' : booleanPair ? 'boolean' : undefined;
            },
            // Literal powers are handled by the guarded input path. Accepting
            // the generic overload here would admit computed/negative exponents.
            operator: (operation, inputs) => {
                if (operation.name === '**') return undefined;
                const signature = loopOperatorSignature(operation.name, inputs, host.nativeCalls);
                return signature?.result === 'real' && !host.reals ? undefined : signature;
            },
            budget: { remaining: 1024 },
        }, hint);
        if (inferred.failure) return reject(inferred.failure.source, inferred.failure.detail);
        return lower(inferred.expression, lines) ?? reject(e);
    }
    function lower(node: CompiledExpression<CompiledLoopType, LoopInput>, lines: string[]): LoopTerm | undefined {
        // Real intermediates are allowed in Number regions; published
        // registers still have to satisfy the integer/boolean binding contract.
        if (state.serial > 256) return undefined;
        if (node.kind === 'group') return lower(node.operand, lines);
        if (node.kind === 'literal') {
            const value = node.value;
            if (numberMode && typeof value === 'bigint' && !Number.isSafeInteger(Number(value))) return undefined;
            return { type: node.type, code: typeof value === 'bigint' ? `${value}${numberMode ? '' : 'n'}`
                : typeof value === 'number' ? Object.is(value, -0) ? '-0' : String(value) : JSON.stringify(value) };
        }
        if (node.kind === 'input') {
            lines.push(...node.input.lines);
            return node.input.term;
        }
        if (node.kind === 'call') return undefined; // Calls are guarded loop inputs above.
        if (node.kind === 'unary') {
            const value = lower(node.operand, lines), token = node.operation.unary;
            if (!value || token === undefined) return undefined;
            return { code: token === '' ? value.code : node.type === 'integer' ? safe(`${token}(${value.code})`) : `${token}(${value.code})`, type: node.type };
        }
        const left = lower(node.left, lines);
        const token = node.operation.binary;
        const guard = token === '&&' || token === '||';
        const rightLines: string[] = guard ? [] : lines;
        const right = lower(node.right, rightLines);
        if (!left || !right || !token) return undefined;
        if (guard) {
            const name = `v${state.serial++}`;
            lines.push(`let ${name} = ${left.code}; if (${node.operation.name === 'and' ? '' : '!'}${name}) { ${rightLines.join('\n')} ${name} = ${right.code}; }`);
            return { code: name, type: node.type };
        }
        const code = arithmetic(node.operation.name, left, right, node.type, lines);
        return code === undefined ? undefined : { code, type: node.type };
    }
    /** One checked binary operator. Compound assignments lower through it
     * too, so division by zero and floor rounding are written once. */
    function arithmetic(op: string, left: LoopTerm, right: LoopTerm, type: LoopTerm['type'], lines: string[]): string | undefined {
        const operation = findCompiledOperator(op);
        const token = operation?.binary;
        if (!operation || !token) return undefined;
        const a = left.code, b = right.code, name = `v${state.serial++}`;
        if (op === '/' || left.type === 'real' || right.type === 'real') {
            // The interpreter's coercions: Number for arithmetic, exact
            // bigint/number relations, and `==` for integral equality.
            if (token === '//' || token === '%') return undefined;
            const real = (term: LoopTerm) => term.type === 'integer' ? `Number(${term.code})` : `(${term.code})`;
            const mixed = left.type !== right.type;
            if (op === '/') lines.push(`if (${zeroTestSource(b, right.type === 'integer' && !numberMode ? 'integer' : 'real')}) throw zero();`);
            if (op === '**') lines.push(`if (${zeroTestSource(a, left.type === 'integer' && !numberMode ? 'integer' : 'real')} && (${b}) < 0) throw powerZero();`);
            lines.push(`const ${name} = ${type === 'boolean' ? binaryOperatorSource(operation, a, b, { mixed }) : binaryOperatorSource(operation, real(left), real(right))};`);
            if (op === '**') lines.push(`if (Number.isNaN(${name})) throw powerDomain();`);
            return name;
        }
        if (token !== '//' && token !== '%') {
            lines.push(`const ${name} = ${type === 'integer' ? safe(binaryOperatorSource(operation, a, b)) : binaryOperatorSource(operation, a, b)};`);
            return name;
        }
        const remainder = `m${state.serial++}`;
        lines.push(`if (${zeroTestSource(b, numberMode ? 'real' : 'integer')}) throw zero();`, `const ${remainder} = (${a}) % (${b});`);
        lines.push(`const ${name} = ${binaryOperatorSource(operation, a, b, { remainder, number: numberMode, safe })};`);
        return name;
    }
    /** Lower an audited catalogue call. Argument reads remain in source order;
     * runtime binding still checks the module and current builtin on every entry. */
    function emitBuiltinCall(operation: Operation, operands: readonly Expression[], lines: string[]): LoopTerm | undefined {
        if (numberMode) return undefined;
        const signature = operation.compiledCall!;
        const arguments_: string[] = [];
        const types: string[] = [];
        let firstType: LoopTerm['type'] | undefined;
        for (const [index, input] of signature.inputs.entries()) {
            let part = operands[index];
            while (isParenthesizedExpression(part)) part = part.value;
            if (input === 'text-array') {
                if (!host.textArrayLoops || !isNameExpression(part) || part.name.includes('.')) return undefined;
                const previous = arrays.get(part.name);
                if (previous && (previous.rank !== 1 || previous.type !== 'text')
                    || localTypes.has(part.name)) return undefined;
                const info = previous ?? { slot: slot(part.name), rank: 1, type: 'text' as const };
                arrays.set(part.name, info);
                if (!assigned.has(part.name)) arrayInputs.add(part.name);
                arguments_.push(`r${info.slot}`);
                types.push('text-array');
                continue;
            }
            const expected = input === 'text-or-array' ? 'text' : input === 'same' ? firstType
                : input === 'text-or-bytes' ? knownType(part) ?? (isNameExpression(part) ? 'text' : undefined) : input;
            const value = emit(operands[index], lines, expected);
            if (!value || expected && value.type !== expected
                || input === 'text-or-bytes' && !['text', 'bytes'].includes(value.type)) return undefined;
            firstType ??= value.type;
            arguments_.push(value.code);
            types.push(value.type);
        }
        const name = `v${state.serial++}`, index = calls.length;
        // Catalogue compiled calls are synchronous operations with
        // no Rank callbacks; bind() checks the current builtin.
        calls.push({ name: operation.name, locals: [], stableArrayReads: true,
            bind: host.prepareBuiltinCall(operation.module, operation.name, types) });
        lines.push(`const ${name} = calls[${index}]([${arguments_.join(',')}]);`);
        return { code: name, type: signature.result };
    }
    function emitInput(e: Expression, lines: string[], hint?: LoopTerm['type'], tail = false): LoopTerm | undefined {
        if (state.serial > 256) return undefined;
        if (isNameExpression(e) && !e.name.includes('.')) {
            if (arrays.has(e.name)) return undefined;
            const type = localTypes.get(e.name) ?? (textSources.has(e.name) ? 'text' : hint ?? realInput(e.name) ?? 'integer');
            if (hint && type !== hint || type === 'boolean' && !host.booleanLocals) return undefined;
            localTypes.set(e.name, type);
            const index = slot(e.name);
            if (!assigned.has(e.name)) required.add(index);
            return { code: `r${index}`, type };
        }
        if (host.extrema && isApplicationExpression(e)) {
            const parts = host.extremeParts(e);
            if (parts && extremeChain(parts)) return emitExtreme(parts, lines);
        }
        if (isApplicationExpression(e) && e.arguments.length === 1 && isNameExpression(e.arguments[0])) {
            const op = e.arguments[0].name;
            if (!numberMode && op === 'text' && host.scalarText) {
                const value = emit(e.head, lines);
                if (value?.type !== 'integer') return undefined;
                builtins.set(op, 'core');
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = (${value.code}).toString();`);
                // Decimal integer rendering has one UTF-16 unit per code point.
                return { code: name, type: 'text', ascii: true };
            }
            if (!numberMode && op === 'len' && host.scalarText) {
                if (host.nativeCalls && knownType(e.head) === 'bytes') {
                    const value = emit(e.head, lines, 'bytes');
                    if (!value) return undefined;
                    builtins.set(op, 'core');
                    return { code: `BigInt(${value.code}.shape[0])`, type: 'integer' };
                }
                const array = isNameExpression(e.head) ? arrays.get(e.head.name) : undefined;
                if (array && isNameExpression(e.head)) {
                    if (!assigned.has(e.head.name)) arrayInputs.add(e.head.name);
                    builtins.set(op, 'core');
                    return { code: `BigInt(r${array.slot}.shape[0] ?? 0)`, type: 'integer' };
                }
                const knownText = isStringLiteral(e.head) || isApplicationExpression(e.head)
                    || isParenthesizedExpression(e.head)
                    || isNameExpression(e.head) && (localTypes.get(e.head.name) === 'text' || textSources.has(e.head.name));
                if (knownText) {
                    const value = emit(e.head, lines);
                    if (value?.type !== 'text') return undefined;
                    builtins.set(op, 'core');
                    const name = `v${state.serial++}`;
                    lines.push(`const ${name} = BigInt(${value.ascii ? `(${value.code}).length` : `[...(${value.code})].length`});`);
                    return { code: name, type: 'integer' };
                }
            }
            const builtin = inlineBuiltins.get(op);
            if (builtin && (builtin.enabled?.(host) ?? true) && flattenApplication(e).length === 2) {
                const value = emit(e.head, lines);
                const type = value && builtin.types[value.type];
                if (!value || !type) return undefined;
                builtins.set(op, builtin.module);
                const test = builtin.domain?.test(value.code, value.type);
                if (test) lines.push(`if (${test}) throw domain(${JSON.stringify(builtin.domain!.message)});`);
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = ${builtin.code(value.code, value.type, numberMode)};`);
                return { code: name, type };
            }
            if (!numberMode && (op === 'len' || op === 'pop') && isNameExpression(e.head)) {
                const receiver = container(e.head.name, 'deque', op === 'pop');
                if (!receiver) return undefined;
                builtins.set(op, op === 'len' ? 'core' : 'algo');
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = ${op === 'len' ? `BigInt(${receiver}.size)` : `${receiver}.pop()`};`);
                return { code: name, type: 'integer' };
            }
        }
        if (isApplicationExpression(e)) {
            const parts = flattenApplication(e), last = parts.at(-1);
            if (last && isNameExpression(last) && !last.name.includes('.')) {
                const operation = host.nativeCalls ? findOperation(last.name) : undefined;
                const signature = operation?.compiledCall;
                const prepareCallee = host.scalarFunction(last.name, parts.length - 1);
                // Prefer a known user function while its namesake module is unopened.
                // An unresolved name can still bind the builtin after a later import.
                if (operation && signature && signature.inputs.length === parts.length - 1
                    && (host.module(operation.module) || !prepareCallee)) {
                    return emitBuiltinCall(operation, parts.slice(0, -1), lines);
                }
                if (prepareCallee && !numberMode) {
                    const arguments_: string[] = [];
                    const types: CompiledCalleeType[] = [];
                    for (let part of parts.slice(0, -1)) {
                        while (isParenthesizedExpression(part)) part = part.value;
                        const existing = isNameExpression(part) ? arrays.get(part.name) : undefined;
                        const current = isNameExpression(part) && !localTypes.has(part.name) ? host.read(part.name) : undefined;
                        if (current && isNameExpression(part) && (current instanceof RankDeque
                            || isRankIndex(current) && current.entries instanceof ResourceMap)) {
                            const kind = current instanceof RankDeque ? 'deque' : 'index';
                            const receiver = container(part.name, kind);
                            if (!receiver) return undefined;
                            containers.get(part.name)!.integers = true;
                            arguments_.push(receiver);
                            if (current instanceof RankDeque) {
                                containers.get(part.name)!.mode = current.mode;
                                types.push({ kind: 'deque', mode: current.mode });
                            } else types.push({ kind: 'index' });
                            continue;
                        }
                        const type = existing ? { kind: 'array' as const, element: existing.type, rank: existing.rank }
                            : current === undefined ? undefined : compiledArgumentType(current);
                        if (type && typeof type !== 'string' && isNameExpression(part)) {
                            if (!host.arrayReads || type.element === 'real' || type.element === 'bytes'
                                || type.element === 'text' && !host.textArrayLoops
                                || type.element === 'boolean' && !host.booleanArrays) return undefined;
                            const info = existing ?? { slot: slot(part.name), rank: type.rank, type: type.element };
                            arrays.set(part.name, info);
                            calleeArrays.add(part.name);
                            if (!assigned.has(part.name)) arrayInputs.add(part.name);
                            arguments_.push(`r${info.slot}`);
                            types.push({ kind: 'array', element: type.element, rank: type.rank });
                        } else {
                            const value = emit(part, lines, knownType(part));
                            if (!value || value.type === 'bytes' || value.type === 'real') return undefined;
                            arguments_.push(value.code);
                            types.push(value.type);
                        }
                    }
                    const callable = prepareCallee(types);
                    if (callable?.type === 'real') return reject(e, 'unsupported-type:real');
                    if (callable) {
                        const name = `v${state.serial++}`, index = calls.length;
                        // The proof fixes input domains and permitted mutations.
                        // Binding identity is rechecked at every region entry.
                        calls.push({ name: last.name, locals: callable.locals, stableArrayReads: callable.effects.stableArrayReads, bind: callable.bind });
                        lines.push(`const ${name} = calls[${index}]([${arguments_.join(',')}]${tail ? ', tailCallsAllowed' : ''});`);
                        return { code: name, type: callable.type };
                    }
                }
            }
        }
        if (isApplicationExpression(e)) {
            if (!host.arrayReads) return undefined;
            const [head, ...arguments_] = flattenApplication(e);
            if (!isNameExpression(head) || head.name.includes('.')) return undefined;
            const current = !localTypes.has(head.name) && !arrays.has(head.name) ? host.read(head.name) : undefined;
            if (!numberMode && current && isRankIndex(current) && current.entries instanceof IndexEntries) {
                if (hint && hint !== 'integer' || !arguments_.length) return undefined;
                const receiver = container(head.name, 'index', true);
                if (!receiver) return undefined;
                const keys: string[] = [];
                for (const argument of arguments_) {
                    const key = emit(argument, lines, 'integer');
                    if (key?.type !== 'integer') return undefined;
                    keys.push(key.code);
                }
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = indexRead(${receiver}, key([${keys.join(',')}]));`);
                return { code: name, type: 'integer' };
            }
            if (!numberMode && host.nativeCalls && host.textLoops && knownType(head) === 'text') {
                if (arguments_.length !== 1) return undefined;
                const receiver = emit(head, lines, 'text'), index = emit(arguments_[0], lines, 'integer');
                if (!receiver || index?.type !== 'integer') return undefined;
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = textRead(${receiver.code}, ${index.code});`);
                return { code: name, type: 'text' };
            }
            if (!numberMode && host.nativeCalls && knownType(head) === 'bytes') {
                if (arguments_.length !== 1) return undefined;
                const receiver = emit(head, lines, 'bytes'), index = emit(arguments_[0], lines, 'integer');
                if (!receiver || index?.type !== 'integer') return undefined;
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = arrayRead(${receiver.code}, [${index.code}]);`);
                return { code: name, type: 'integer' };
            }
            const previous = arrays.get(head.name);
            const type = previous?.type ?? destinations.get(head.name)?.type ?? hint ?? realInput(head.name) ?? 'integer';
            if (type === 'text' && (!host.nativeCalls || !host.textArrayLoops) || type === 'bytes') return undefined;
            if (hint && hint !== type || type === 'boolean' && !host.booleanArrays) return undefined;
            if (previous && previous.rank !== arguments_.length) return undefined;
            const indices: string[] = [];
            for (const argument of arguments_) {
                const value = emit(argument, lines);
                if (value?.type !== 'integer') return undefined;
                indices.push(value.code);
            }
            const info = previous ?? { slot: slot(head.name), rank: indices.length, type };
            arrays.set(head.name, info);
            if (!assigned.has(head.name)) arrayInputs.add(head.name);
            const name = `v${state.serial++}`;
            if (numberMode) {
                if (info.rank !== 1) return undefined;
                const argument = arguments_[0];
                state.indexedReads.set(head.name, !state.indexedReads.has(head.name) && isNameExpression(argument) ? argument.name : undefined);
                const coordinate = `index${state.serial++}`;
                lines.push(`const ${coordinate} = ${indices[0]};
                    if (${coordinate} < 0 || ${coordinate} >= cells${info.slot}.length) throw badIndex(${coordinate});
                    const ${name} = safe(Number(cells${info.slot}[${coordinate}]));`);
            } else {
                lines.push(`const ${name} = reader${info.slot}(${info.rank === 1 ? indices[0] : `[${indices.join(',')}]`});`);
            }
            return { code: name, type };
        }
        if (!isBinaryExpression(e) || e.step) return undefined;
        if (!numberMode && ['in', 'notin'].includes(e.operator) && isNameExpression(e.right)) {
            const name = e.right.name;
            const key = emit(e.left, lines);
            if (key?.type !== 'integer') return undefined;
            const negate = e.operator === 'notin' ? '!' : '';
            if (host.sequenceMembership && !localTypes.has(name) && !arrays.has(name)
                && compiledIntegerMembership(host.read(name))) {
                const index = calls.length;
                calls.push({ name, locals: [], stableArrayReads: true, bind: () => {
                    const domain = host.read(name);
                    if (domain && isRankArray(domain) && (destinations.size || calls.some(call => !call.stableArrayReads))) return undefined;
                    const contains = compiledIntegerMembership(domain);
                    return contains ? arguments_ => contains(arguments_[0] as bigint) : undefined;
                } });
                return { code: `${negate}calls[${index}]([${key.code}])`, type: 'boolean' };
            }
            const receiver = container(name, 'index');
            if (!receiver) return undefined;
            return { code: `${negate}indexHas(${receiver}, key([${key.code}]))`, type: 'boolean' };
        }
        if (isNameExpression(e.right) && ['reduce', 'scan', 'outer', 'segment'].includes(e.right.name)) return undefined;
        if (e.operator === '**') {
            let exponent = e.right;
            while (isParenthesizedExpression(exponent)) exponent = exponent.value;
            // Power binds before an unparenthesized sign, as in the evaluator.
            const signed = isUnaryExpression(e.left) && ['+', '-'].includes(e.left.operator) ? e.left : undefined;
            const base = emit(signed ? signed.operand : e.left, lines);
            if (!base) return undefined;
            // Keep exact integer powers restricted to nonnegative literals.
            // Real powers have the evaluator's Number coercion and NaN check;
            // infinity is a valid result, and floor/ceil check it themselves.
            const exact = base.type === 'integer' && isNumberLiteral(exponent)
                && typeof exponent.value === 'bigint' && exponent.value >= 0n;
            const right = exact ? undefined : emit(e.right, lines);
            if (!exact && (!host.reals || !right || !loopOperatorSignature('**', [base.type, right.type], host.nativeCalls)
                || base.type === 'integer' && right.type === 'integer')) return undefined;
            const name = `v${state.serial++}`;
            const negative = signed?.operator === '-' ? '-' : '';
            if (exact && isNumberLiteral(exponent)) {
                const literal = exponent.value;
                // JS power is approximate even for integer inputs. Only the
                // trivial powers and one checked multiplication are exact here.
                if (numberMode && literal > 2n) return undefined;
                const code = numberMode ? literal === 0n ? '1' : literal === 1n ? base.code : `(${base.code}) * (${base.code})`
                    : `(${base.code}) ** ${literal}n`;
                lines.push(`const ${name} = ${negative}(${safe(code)});`);
                return { code: name, type: 'integer' };
            }
            const power = arithmetic('**', base, right!, 'real', lines);
            if (power === undefined) return undefined;
            return { code: `${negative}(${power})`, type: 'real' };
        }
        return undefined;
    }
    return { container, slot, knownType, realInput, emit, arithmetic };
}

export type LoopExpressions = ReturnType<typeof createLoopExpressions>;
